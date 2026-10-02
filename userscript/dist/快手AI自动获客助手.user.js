// ==UserScript==
// @name         快手AI自动获客助手
// @namespace    https://github.com/ks-comment-assistant
// @version      1.1.0
// @description  快手AI自动获客助手（开源版）：原「快手自动评论助手 v1.0.2」Chrome 扩展的用户脚本移植版。支持关键词搜索、点赞、收藏、评论（文本/AI），无需授权码。仅供学习交流。
// @author       ks-comment-assistant
// @match        https://www.kuaishou.com/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.deepseek.com
// @connect      api.moonshot.cn
// @connect      api.openai.com
// @connect      openrouter.ai
// @connect      generativelanguage.googleapis.com
// @connect      api.xiaomimimo.com
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// ==/UserScript==

// 本脚本完全开源（MIT License），由以下模块组装而成：
//   open/01-runtime.js  运行时基础层
//   core/core.js        核心引擎（源自原扩展 1:1 移植，授权逻辑已移除）
//   open/20-panel.js    浮动控制面板
//   open/40-donate.js   赞赏支持
//   open/30-main.js     启动引导
(function () {
/*
 * 快手AI自动获客助手 —— 开源模块：运行时基础层（MIT License）
 * 提供存储封装、页面 Window 引用、通知、通用工具函数与跨域请求封装。
 * 对应原 Chrome 扩展的 chrome.storage.local / GM 能力层。
 */

'use strict';

const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

const store = {
  get(key, defaultValue = null) {
    try {
      if (hasGM) {
        const v = GM_getValue(key);
        return v === undefined || v === null ? defaultValue : JSON.parse(v);
      }
      const v = localStorage.getItem('kscap_' + key);
      return v === null ? defaultValue : JSON.parse(v);
    } catch {
      return defaultValue;
    }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    if (hasGM) GM_setValue(key, raw);
    else localStorage.setItem('kscap_' + key, raw);
  },
  remove(key) {
    if (hasGM) GM_deleteValue(key);
    else localStorage.removeItem('kscap_' + key);
  },
  removeMany(keys) {
    keys.forEach((k) => store.remove(k));
  },
};

const PAGE = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;

// ---- 页面内日志：拦截 console 中带前缀的脚本日志，供面板日志窗口展示 ----
const LOG_PREFIX = '[快手AI自动获客助手]';
const logBuffer = [];
function pushLog(level, args) {
  const line = new Date().toLocaleTimeString() + ' ' + level + ' ' + args.map(String).join(' ');
  logBuffer.push(line);
  if (logBuffer.length > 100) logBuffer.shift();
  try {
    if (panel && typeof panel.appendLog === 'function') panel.appendLog(line);
  } catch {}
}
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
console.log = (...args) => {
  const s = args.map(String).join(' ');
  if (s.includes(LOG_PREFIX)) pushLog('INFO', args);
  _origLog(...args);
};
console.error = (...args) => {
  const s = args.map(String).join(' ');
  if (s.includes(LOG_PREFIX) || !s) pushLog('ERROR', args);
  _origErr(...args);
};
const getLogs = () => logBuffer.slice();

const notify = (title, message) => {
  try {
    if (typeof GM_notification === 'function') GM_notification({ title, text: message, timeout: 5000 });
  } catch {}
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);
const pickRandom = (arr, fallback = '') => (!arr || arr.length === 0 ? fallback : arr[Math.floor(Math.random() * arr.length)]);
const parseLines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const splitKeywords = (s) =>
  String(s || '')
    .replace(/，/g, ',')
    .replace(/、/g, ',')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

// 等待单个选择器出现（对应原扩展 R 函数）
async function waitFor(selector, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(200);
  }
  return null;
}

// 依次尝试多个选择器（对应原扩展 O 函数），返回 { element, selector }
async function waitForAny(selectors, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return { element: el, selector: sel };
    }
    await sleep(200);
  }
  return { element: null, selector: '' };
}

// 在选择器列表中找到第一个可见元素（对应原扩展 _ 函数）
function firstVisible(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

// 拟人点击：随机延迟 + 中心坐标 + 完整鼠标事件序列（对应原扩展 m 函数）
async function humanClick(el) {
  if (!el) return false;
  await randDelay(200, 500);
  const rect = el.getBoundingClientRect();
  const opts = {
    bubbles: true,
    cancelable: true,
    view: PAGE,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, opts));
    await randDelay(30, 80);
  }
  return true;
}

// 点击元素视觉中心；若中心点被其他元素覆盖（悬浮预览/遮罩/本脚本面板等），直接点目标本身
async function clickAtCenter(el) {
  await randDelay(200, 400);
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (top && (el.contains(top) || top.contains(el) || top === el)) {
      await humanClick(top);
      return;
    }
    console.log('[快手AI自动获客助手] 目标中心被覆盖(' + ((top && (top.className || top.tagName)) || '无') + ')，改为直接点击目标');
  }
  await humanClick(el);
}

// 向播放器容器派发键盘事件（对应原扩展 g 函数，模拟快手快捷键 Z/C/X/K）
function dispatchKey(key, code) {
  const container = getPlayerContainer();
  const opts = {
    key,
    code,
    keyCode: key.toUpperCase().charCodeAt(0),
    which: key.toUpperCase().charCodeAt(0),
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  container.dispatchEvent(new KeyboardEvent('keydown', opts));
  container.dispatchEvent(new KeyboardEvent('keyup', opts));
  console.log('[快手AI自动获客助手] 键盘事件已派发: ' + key + ' -> ' + (container.className || container.tagName));
}

function getPlayerContainer() {
  return (
    document.querySelector('.player-pop-mask') ||
    document.querySelector('.short-video-detail') ||
    document.querySelector('.swiper-slide-active') ||
    document.querySelector('.main-area') ||
    document.body
  );
}

// 跨域请求封装（替代原扩展的 fetch + host_permissions）
function gmRequest(url, { headers = {}, data = null, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: data ? 'POST' : 'GET',
      url,
      headers,
      data: data ? JSON.stringify(data) : undefined,
      timeout,
      onload: (res) =>
        resolve({
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          statusText: res.statusText,
          text: () => res.responseText,
          json: () => JSON.parse(res.responseText),
        }),
      onerror: () => reject(new Error('AI API网络错误')),
      ontimeout: () => reject(new Error('AI API请求超时')),
    });
  });
}

/*
 * 快手AI自动获客助手 —— 核心引擎（MIT License 开源）
 * 页面流程骨架 1:1 移植自原 Chrome 扩展「快手自动评论助手 v1.0.2」（授权逻辑已移除），
 * 评论管理与搜索筛选引擎对齐「抖音AI自动获客助手」开源版：
 *   - 选择器库 / 拟人点击 / 快捷键兜底（Z 点赞、C 收藏、X 评论、K 暂停连播）
 *   - 搜索筛选（排序依据/发布时间/视频时长/搜索范围）
 *   - 评论方式（回复评论 / 直接评论）、评论类型（表情 / 文本 / AI）
 *   - 回复过滤（包含/排除关键词）、回复前点赞、仅一级评论、每视频评论数
 *   - 任务编排：关键词轮换、进度持久化、页面跳转自动续跑、卡住 5 分钟自动恢复
 *   - 下一个视频：按钮点击优先，指纹校验 + 方向键（ArrowDown）兜底重试
 */

// ============================================================
// 选择器库（快手页面流程，与原扩展 content.js 保持一致）
// ============================================================
const SEL = {
  searchVideoLinks: [
    'a[href*="/short-video/"]',
    'a[href*="/f/"]',
    '.video-card a',
    '.photo-card a',
    '.work-card a',
    '[data-e2e*="video"] a',
  ],
  searchVideoCards: ['.video-list .photo-card', '.video-list .card-container', '.cards .photo-card', '.cards .card-container'],
  playerMask: 'body > div.player-pop-mask',
  detailPagePlayer: '.short-video-detail',
  activeSlide: 'body > div.player-pop-mask .swiper-slide-active',
  autoplayButton: '.swiper-slide-active .auto-play-btn',
  commentPanelButton: '.swiper-slide-active .hover-tip.commentPanel',
  likeButton: '.swiper-slide-active .like-btn',
  favoriteButton: '.swiper-slide-active .star',
  nextButton:
    'body > div.player-pop-mask > div > div > div > div.swiper-slide.swiper-slide-active > div > div.main-area > div > div > div > div > div.video-interact-panel > div.rb > div.next-btn > div.hover-tip.nextVideo > div.next',
  detailNextButton: '.video-switch-next',
  disabledCommentInput:
    'body > div.player-pop-mask > div > div > div > div.swiper-slide.swiper-slide-active > div > div.sidebar.isExpand > div.content-hider > div > div > div.content > div.comment-side > div.input-area > div',
  commentInputs: [
    '.comment-input:not(.disabled) textarea:not(:disabled)',
    '.comment-input:not(.disabled) input:not(:disabled)',
    '.comment-input:not(.disabled) [contenteditable="true"]',
    'textarea.pl-textarea:not(:disabled)',
    '.input-container textarea:not(:disabled)',
    '.input-area input:not(:disabled)',
    '.input-area [contenteditable="true"]',
    '.comment-side [contenteditable="true"]',
    'textarea:not(:disabled)',
    'input[placeholder*="评论"]:not(:disabled)',
    'textarea[placeholder*="评论"]:not(:disabled)',
    'input[placeholder*="说点什么"]:not(:disabled)',
    '[class*="comment"] [contenteditable="true"]',
  ],
  submitButtons: ['.send-btn', '[role="button"].send-btn', '.submit-button:not(:disabled)', '.input-area button', '.comment-side button', '[class*="submit"]', '[class*="publish"]', 'button'],
};

// 评论区通用选择器（回复评论引擎用，文本/类名兜底）
const CSEL = {
  commentContainer: ['.comment-side', '.comment-list', '[class*="comment-side"]', '[class*="comment-list"]'],
  commentItem: ['.comment-item', '[class*="comment-item"]', '[class*="commentItem"]'],
  replyContainer: ['.reply-container', '[class*="reply"]'],
  // 快手评论输入区的表情按钮为 .emot-btn
  emojiButton: ['.emot-btn', '[class*="emoji"]', '.comment-side [class*="emoji"]'],
  emojiPanelItem: ['[class*="emoji"] img', '[class*="emoji"] span', '[class*="emot"] img', '[class*="emot"] span', '[class*="emoji-list"] *'],
};

// ============================================================
// AI 平台配置（与原扩展一致，模型名未改动）
// ============================================================
const AI_PROVIDERS = {
  deepseek: { name: 'DeepSeek', apiUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-pro', authHeader: 'authorization' },
  kimi: { name: 'Kimi', apiUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'kimi-k3', authHeader: 'authorization' },
  openai: { name: 'OpenAI', apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna', authHeader: 'authorization' },
  openrouter: { name: 'OpenRouter', apiUrl: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-5.6-luna', authHeader: 'authorization' },
  ollama: { name: 'Ollama', apiUrl: 'http://127.0.0.1:11434/v1/chat/completions', model: 'qwen2.5:7b', authHeader: null },
  gemini: {
    name: 'Gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    model: 'gemini-3.6-flash',
    authHeader: 'key',
  },
  xiaomimimo: {
    name: '小米 MiMo',
    apiUrl: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-pro',
    authHeader: 'api-key',
    maxTokensField: 'max_completion_tokens',
    disableThinking: true,
  },
};

const AI_MAX_TOKENS = 512;
const AI_SYSTEM_PROMPT = '你是快手评论助手。只输出一条可直接发布的最终回复，不要解释，不要展示推理过程，不要加引号。';
const COMMENT_TYPE = { EMOJI: 'emoji', TEXT: 'text', AI: 'ai' };

// ============================================================
// AI 客户端（对应原扩展类 F；fetch 改为 GM_xmlhttpRequest 以解决跨域）
// ============================================================
class AIClient {
  constructor(settings) {
    this.settings = settings;
    this.provider = settings.aiModel || 'deepseek';
    this.apiKey = settings.apiKey || settings.aiApiKey || '';
    this.customBaseUrl = settings.aiBaseUrl || '';
    this.customModel = settings.aiCustomModel || '';
  }

  requiresApiKey() {
    return this.provider !== 'ollama';
  }

  async getAIComment(videoDesc, userComment = '', customPrompt = '') {
    if (this.requiresApiKey() && !this.apiKey) throw new Error('AI API密钥未配置');
    const conf = AI_PROVIDERS[this.provider];
    if (!conf) throw new Error('不支持的AI平台');
    const prompt = this.buildPrompt(videoDesc, userComment, customPrompt);
    const resp = await this.callAIAPI(conf, prompt);
    return this.parseAIResponse(resp);
  }

  buildPrompt(videoDesc, userComment, customPrompt = '') {
    const base = customPrompt || '结合视频内容和用户评论给一个自然、简短的快手回复，20字以内。';
    const commentLine = userComment ? '用户评论：' + userComment : '用户评论：无';
    return base + '\n\n视频描述：' + (videoDesc || '未提供视频描述') + '\n' + commentLine + '\n直接输出回复：';
  }

  async callAIAPI(conf, prompt) {
    if (this.provider === 'gemini') return this.callGeminiAPI(conf, prompt);
    const body = {
      model: this.provider === 'ollama' && this.customModel ? this.customModel : conf.model,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    };
    body[conf.maxTokensField || 'max_tokens'] = AI_MAX_TOKENS;
    if (conf.disableThinking) body.thinking = { type: 'disabled' };

    const headers = { 'Content-Type': 'application/json' };
    if (this.requiresApiKey()) {
      if (conf.authHeader === 'api-key') headers['api-key'] = this.apiKey;
      else headers['Authorization'] = 'Bearer ' + this.apiKey;
    }
    if (this.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://www.kuaishou.com/';
      headers['X-Title'] = 'Kuaishou Comment Assistant';
    }
    const res = await gmRequest(this.customBaseUrl || conf.apiUrl, { headers, data: body });
    if (!res.ok) {
      throw new Error('AI API请求失败: ' + res.status + ' ' + res.statusText + ' ' + res.text());
    }
    return res.json();
  }

  async callGeminiAPI(conf, prompt) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' + conf.model + ':generateContent?key=' + this.apiKey;
    const res = await gmRequest(url, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: AI_MAX_TOKENS, temperature: 0.7 },
      },
    });
    if (!res.ok) throw new Error('Gemini API请求失败: ' + res.status + ' ' + res.statusText + ' ' + res.text());
    return res.json();
  }

  parseAIResponse(resp) {
    if (this.provider === 'gemini') {
      const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text.trim()) return text.trim();
      throw new Error('AI响应内容为空或无法解析，finish_reason=' + (resp?.candidates?.[0]?.finishReason || 'unknown'));
    }
    const text = resp?.choices?.[0]?.message?.content || '';
    if (text.trim()) return text.trim();
    throw new Error('AI响应内容为空或无法解析，finish_reason=' + (resp?.choices?.[0]?.finish_reason || 'unknown'));
  }
}

// ============================================================
// 搜索筛选（对齐抖音版 SearchFlow.applySearchFilters：文本定位「筛选」入口与选项）
// ============================================================
const searchFlow = {
  async applySearchFilters(filters = {}) {
    const configured = [filters.searchSortBy, filters.searchPublishTime, filters.searchDuration, filters.searchScope].filter(Boolean);
    if (configured.length === 0) return console.log('[快手AI自动获客助手] 未配置搜索筛选条件，跳过筛选操作');
    console.log('[快手AI自动获客助手] 准备应用搜索筛选条件:', filters);
    const trigger = this.findFilterTrigger();
    if (!trigger) return console.warn('[快手AI自动获客助手] 未找到筛选按钮，跳过筛选操作');
    await this.openFilterPanel(trigger);
    const panel = await this.waitForFilterPanel();
    if (!panel) return console.warn('[快手AI自动获客助手] 未找到筛选面板，跳过筛选操作');
    await this.applyFilterOption(panel, filters.searchSortBy, '排序依据');
    await this.applyFilterOption(panel, filters.searchPublishTime, '发布时间');
    await this.applyFilterOption(panel, filters.searchDuration, '视频时长');
    await this.applyFilterOption(panel, filters.searchScope, '搜索范围');
    await randDelay(1500, 2500);
  },
  findFilterTrigger() {
    const candidates = Array.from(document.querySelectorAll('div, span, button')).filter(
      (el) => el.textContent?.trim() === '筛选',
    );
    return (
      candidates.find((el) => el.querySelector('img, svg') || el.parentElement?.querySelector('img, svg')) ||
      candidates[0] ||
      null
    );
  },
  async openFilterPanel(trigger) {
    const target = trigger.closest('div, button, span') || trigger;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: PAGE }));
    }
    // 快手为点击展开，悬浮无效时补一次真实点击
    await randDelay(400, 800);
    if (!this.getFilterPanel()) await humanClick(target);
    await randDelay(400, 800);
  },
  async waitForFilterPanel() {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const panel = this.getFilterPanel();
      if (panel) return panel;
      await randDelay(150, 250);
    }
    return null;
  },
  getFilterPanel() {
    // 快手筛选面板包含「排序/发布时间/时长/范围」等字样
    return (
      Array.from(document.querySelectorAll('div')).find((el) => {
        const t = el.textContent || '';
        return t.includes('排序') && (t.includes('发布时间') || t.includes('时长') || t.includes('范围'));
      }) || null
    );
  },
  async applyFilterOption(panel, value, label) {
    if (!value) return console.log('[快手AI自动获客助手] ' + label + '未配置，跳过');
    const root = this.getFilterPanel() || panel;
    const option = Array.from(root.querySelectorAll('span, div, button')).find(
      (el) => el.textContent?.trim() === value,
    );
    if (!option) return console.warn('[快手AI自动获客助手] 未找到筛选项: ' + label + ' -> ' + value + '，跳过');
    console.log('[快手AI自动获客助手] 应用筛选项: ' + label + ' -> ' + value);
    option.click();
    await randDelay(800, 1400);
    const trigger = this.findFilterTrigger();
    if (trigger && !this.getFilterPanel()) {
      await this.openFilterPanel(trigger);
      await this.waitForFilterPanel();
    }
  },
};

// ============================================================
// 评论管理器（对齐抖音版 CommentManager，适配快手评论区 DOM）
// ============================================================
class CommentManager {
  constructor(settings, commentsList, hooks = {}) {
    this.settings = settings;
    this.commentsList = commentsList;
    this.hooks = hooks;
    this.processedComments = new Set();
    this.aiService = null;
  }

  async processComments(done) {
    console.log('[快手AI自动获客助手] 开始处理评论，每个视频评论数:', this.settings.commentsPerVideo);
    const container = await waitForAny(CSEL.commentContainer, 3000);
    const items = this.getTopLevelComments(container.element || document);
    console.log('[快手AI自动获客助手] 找到 ' + items.length + ' 条一级评论');
    if (items.length === 0) {
      console.log('[快手AI自动获客助手] 未找到任何评论，回退为直接评论');
      if (await this.directComment()) done++;
      return done;
    }
    let noReplyEntry = 0; // 连续多条都没有回复入口，说明平台无此交互，尽早放弃
    for (let i = 0; i < items.length && done < this.settings.commentsPerVideo; i++) {
      if (this.hooks.shouldStop && this.hooks.shouldStop()) {
        console.log('[快手AI自动获客助手] 检测到停止指令，终止评论处理');
        return done;
      }
      const item = items[i];
      if (this.isCommentProcessed(item)) {
        console.log('[快手AI自动获客助手] 跳过已处理的评论');
        continue;
      }
      const text = this.getCommentText(item);
      if (!this.shouldReplyToComment(text)) {
        console.log('[快手AI自动获客助手] 评论不符合过滤条件，跳过该评论');
        this.markCommentAsProcessed(item);
        continue;
      }
      try {
        const replyBtn = await this.findReplyButtonWithFallback(item);
        if (replyBtn) {
          console.log('[快手AI自动获客助手] 准备回复第 ' + (i + 1) + ' 条评论');
          if (this.settings.likeBeforeReply) await this.likeComment(item);
          if (await this.handleReply(replyBtn, item, text)) {
            done++;
            this.markCommentAsProcessed(item);
            console.log('[快手AI自动获客助手] 已完成第 ' + done + ' 条评论，目标: ' + this.settings.commentsPerVideo + ' 条');
            await randDelay(2000, 3000);
          } else {
            console.log('[快手AI自动获客助手] 回复发布失败，跳过当前评论');
            this.markCommentAsProcessed(item);
          }
        } else {
          noReplyEntry++;
          console.log('[快手AI自动获客助手] 第 ' + (i + 1) + ' 条评论未找到回复按钮');
          this.markCommentAsProcessed(item);
          // 连续 5 条都没有回复入口：平台（快手网页版）无回复交互，直接转直接评论
          if (noReplyEntry >= 5) {
            console.log('[快手AI自动获客助手] 连续 ' + noReplyEntry + ' 条评论无回复入口，判定平台不支持回复，转直接评论');
            break;
          }
        }
      } catch (err) {
        console.log('[快手AI自动获客助手] 处理第 ' + (i + 1) + ' 条评论时出错:', err);
        this.markCommentAsProcessed(item);
        continue;
      }
    }
    console.log('[快手AI自动获客助手] 当前视频评论完成，共评论 ' + done + ' 条，目标: ' + this.settings.commentsPerVideo + ' 条');
    // 整轮未回复成功时，回退为直接评论，保证每视频仍有产出（停止时不再回退）
    if (done === 0 && this.settings.commentsPerVideo > 0 && !(this.hooks.shouldStop && this.hooks.shouldStop())) {
      console.log('[快手AI自动获客助手] 未能回复任何评论，回退为直接评论');
      if (await this.directComment()) done++;
    }
    return done;
  }

  getTopLevelComments(rootEl) {
    if (!rootEl) return [];
    let items = [];
    for (const sel of CSEL.commentItem) {
      items = Array.from(rootEl.querySelectorAll(sel)).filter(isVisible);
      if (items.length > 0) break;
    }
    if (items.length === 0) {
      // 兜底：评论区直接子级中含头像或回复字样的节点
      items = Array.from(rootEl.querySelectorAll('div'))
        .filter((el) => isVisible(el) && el.querySelector('[class*="avatar"], img') && el.textContent?.includes('回复') === false && el.children.length >= 2)
        .slice(0, 30);
    }
    const unique = items.filter((el, i, all) => all.indexOf(el) === i);
    if (this.settings.onlyFirstLevel) {
      return unique.filter((el) => !el.closest(CSEL.replyContainer.join(',')));
    }
    return unique;
  }

  isCommentProcessed(item) {
    return (
      this.processedComments.has(this.commentId(item)) ||
      item.dataset.commented === 'true' ||
      item.hasAttribute('data-processed')
    );
  }

  commentId(item) {
    return (this.getCommentAuthor(item) || '') + '_' + (this.getCommentText(item) || '');
  }

  getCommentAuthor(item) {
    return item.querySelector('[class*="author"], [class*="name"], [class*="user"]')?.textContent?.trim() || '';
  }

  markCommentAsProcessed(item) {
    this.processedComments.add(this.commentId(item));
    item.dataset.commented = 'true';
    item.dataset.processed = 'true';
  }

  getCommentText(item) {
    const el =
      item.querySelector('[class*="content"], [class*="text"], [class*="desc"], p') ||
      item;
    return (el.textContent?.trim() || '').slice(0, 200);
  }

  shouldReplyToComment(text) {
    const { commentIncludeKeywords, commentExcludeKeywords } = this.settings;
    if (!commentIncludeKeywords && !commentExcludeKeywords) return true;
    if (commentIncludeKeywords && commentIncludeKeywords.trim()) {
      const includes = commentIncludeKeywords.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      if (includes.length > 0) {
        if (!includes.some((k) => text.includes(k))) {
          console.log('[快手AI自动获客助手] 评论不包含设定的关键词 [' + includes.join(', ') + ']，跳过');
          return false;
        }
        console.log('[快手AI自动获客助手] 评论包含关键词，通过包含条件检查');
      }
    }
    if (commentExcludeKeywords && commentExcludeKeywords.trim()) {
      const excludes = commentExcludeKeywords.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      if (excludes.length > 0) {
        const hit = excludes.find((k) => text.includes(k));
        if (hit) {
          console.log('[快手AI自动获客助手] 评论包含排除的关键词 [' + hit + ']，跳过');
          return false;
        }
        console.log('[快手AI自动获客助手] 评论不包含排除的关键词，通过排除条件检查');
      }
    }
    return true;
  }

  // 回复入口定位：文本「回复」按钮 → 点击评论内容进入回复状态（快手网页版登录后，
  // 点击评论内容会让输入框占位符变为「回复 @用户」）
  async findReplyButtonWithFallback(item) {
    const btn = this.findReplyButton(item);
    if (btn) return btn;
    try {
      const area = item.querySelector('.comment-area, [class*="content"]');
      if (!area) return null;
      const rect = area.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: PAGE, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      for (const t of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) area.dispatchEvent(new MouseEvent(t, opts));
      await randDelay(600, 1000);
      const input = await findCommentInput(2000);
      if (input) {
        const ph = input.placeholder || input.getAttribute('placeholder') || '';
        console.log('[快手AI自动获客助手] 点击评论内容后输入框占位符: "' + ph + '"');
        if (ph.includes('回复') || ph.includes('@')) {
          console.log('[快手AI自动获客助手] 通过点击评论内容进入回复状态');
          return area;
        }
      }
    } catch {}
    return null;
  }

  findReplyButton(item) {
    const clickable = Array.from(item.querySelectorAll('div, span, button, p')).filter((el) => {
      if (el === item) return false;
      if (el.textContent && el.textContent.length > 20) return false;
      const style = window.getComputedStyle(el);
      return style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
    });
    return (
      clickable.find((el) => el.textContent?.trim() === '回复') ||
      clickable.find((el) => el.textContent?.includes('回复')) ||
      item.querySelector('[class*="reply"]:not([class*="container"]):not([class*="list"])') ||
      null
    );
  }

  async likeComment(item) {
    try {
      const likeBtn = item.querySelector('[class*="like"], [class*="praise"], svg[class*="like"]');
      if (!likeBtn) return console.log('[快手AI自动获客助手] 未找到评论点赞按钮，跳过点赞'), false;
      console.log('[快手AI自动获客助手] 执行评论点赞操作...');
      await humanClick(likeBtn);
      await randDelay(800, 1200);
      return true;
    } catch (err) {
      console.log('[快手AI自动获客助手] 评论点赞失败，继续执行回复流程:', err);
      return false;
    }
  }

  async handleReply(replyBtn, item, floorText) {
    await humanClick(replyBtn);
    await randDelay(1000, 2000);
    const input = await findCommentInput(5000);
    if (!input) {
      console.log('[快手AI自动获客助手] 回复输入框未出现，点击可能失败');
      return false;
    }
    console.log('[快手AI自动获客助手] 检测到回复输入框，点击成功');
    return await this.inputCommentText(input, floorText);
  }

  async inputCommentText(input, floorText) {
    console.log('[快手AI自动获客助手] 开始评论流程，评论类型:', this.settings.commentType, '原始评论内容:', floorText);
    let content = floorText;
    if (this.settings.commentType === COMMENT_TYPE.AI) {
      try {
        console.log('[快手AI自动获客助手] 开始AI评论处理流程...');
        this.aiService ||= new AIClient(this.settings);
        const desc = getVideoDescription();
        const prompt = this.settings.aiPrompt;
        content = await this.aiService.getAIComment(desc, floorText, prompt);
        console.log('[快手AI自动获客助手] AI生成的评论:', content);
      } catch (err) {
        console.error('[快手AI自动获客助手] 获取AI回复失败，使用默认评论:', err);
        content = '[微笑]';
      }
    } else if (this.settings.commentType === COMMENT_TYPE.TEXT) {
      console.log('[快手AI自动获客助手] 使用配置的内容进行回复');
      content = pickRandom(this.commentsList, '[微笑]');
    }
    console.log('[快手AI自动获客助手] 最终评论内容:', content);
    return await this.executeCommentFlow(input, content);
  }

  async executeCommentFlow(input, content) {
    if (typeof this.hooks.beforeCommentSubmit === 'function') await this.hooks.beforeCommentSubmit();
    if (this.settings.commentType === COMMENT_TYPE.EMOJI) {
      // 表情评论：优先点击表情面板随机表情，失败则输入文本表情兜底
      if (!(await this.inputRandomEmoji(input))) fillCommentInput(input, content || '[微笑]');
    } else {
      fillCommentInput(input, content);
    }
    if (typeof this.hooks.afterCommentSubmit === 'function') await this.hooks.afterCommentSubmit();
    const acted = await clickSubmit(input);
    if (!acted) return false;
    // 验证是否真实发布：未验证通过不算成功
    const ok = await verifyCommentPosted(input, content);
    if (!ok) {
      console.error('[快手AI自动获客助手] 评论提交后未检测到发布成功（输入框未清空且评论区无该内容）');
      if (panel) panel.setStatus('评论可能未发出：请检查登录状态，或在评论区确认', 'error');
    }
    return ok;
  }

  async inputRandomEmoji(input) {
    try {
      const emojiBtn = firstVisible(CSEL.emojiButton);
      if (!emojiBtn) return false;
      await humanClick(emojiBtn);
      await randDelay(800, 1500);
      let pool = [];
      for (const sel of CSEL.emojiPanelItem) {
        pool = Array.from(document.querySelectorAll(sel)).filter((el) => isVisible(el) && (el.tagName === 'IMG' || el.textContent?.trim()));
        if (pool.length > 0) break;
      }
      if (pool.length === 0) {
        console.log('[快手AI自动获客助手] 未找到表情面板，回退文本表情');
        return false;
      }
      const emoji = pool[Math.floor(Math.random() * pool.length)];
      console.log('[快手AI自动获客助手] 选择随机表情...');
      await humanClick(emoji);
      await randDelay(800, 1500);
      return true;
    } catch (err) {
      console.log('[快手AI自动获客助手] 表情输入失败:', err);
      return false;
    }
  }

  async directComment() {
    try {
      console.log('[快手AI自动获客助手] 开始直接评论流程...', '评论类型配置:', this.settings.commentType);
      const input = await findCommentInput(5000);
      if (!input) {
        console.log('[快手AI自动获客助手] 未找到评论输入框');
        return false;
      }
      let content = '';
      if (this.settings.commentType === COMMENT_TYPE.AI) {
        try {
          this.aiService ||= new AIClient(this.settings);
          const desc = getVideoDescription();
          const prompt = this.settings.aiPrompt;
          content = await this.aiService.getAIComment(desc, '', prompt);
          console.log('[快手AI自动获客助手] AI生成的评论内容:', content);
        } catch (err) {
          console.error('[快手AI自动获客助手] 获取AI回复失败，使用默认评论:', err);
          content = '[微笑]';
        }
      } else if (this.settings.commentType === COMMENT_TYPE.TEXT) {
        content = pickRandom(this.commentsList, '[微笑]');
        console.log('[快手AI自动获客助手] 选择的文本评论内容:', content);
      } else {
        console.log('[快手AI自动获客助手] 使用表情评论模式');
        content = '[微笑]';
      }
      console.log('[快手AI自动获客助手] 最终评论内容:', content);
      return await this.executeCommentFlow(input, content);
    } catch (err) {
      console.error('[快手AI自动获客助手] 直接评论过程中出错:', err);
      return false;
    }
  }
}

// ============================================================
// 任务状态（替代原扩展 background.js 的内存变量 + chrome.storage）
// ============================================================
const task = {
  running: false,
  settings: null,
  keywordIndex: 0,
  videoIndex: 0,
  commentedCount: 0,
  lastCommentTime: 0,
  currentKeyword: '',
  manager: null,
};

// 任务清理范围：只清任务状态，settings（用户配置）永久保留
const STATE_KEYS = ['taskRunning', 'taskProgress', 'lastCommentTime', 'accumulatedVideos', 'accumulatedComments'];

function persistProgress() {
  const progress = {
    keywordIndex: task.keywordIndex,
    videoIndex: task.videoIndex,
    commentedCount: task.commentedCount,
    lastUpdate: Date.now(),
  };
  store.set('taskProgress', progress);
  if (panel) panel.updateProgress(progress);
}

function startTask(settings) {
  if (task.running) return { success: false, message: '任务已在运行中' };
  task.running = true;
  task.settings = settings;
  task.keywordIndex = 0;
  task.videoIndex = 0;
  task.commentedCount = 0;
  task.lastCommentTime = 0;
  task.manager = null;
  store.set('taskRunning', true);
  store.set('settings', settings);
  store.set('lastCommentTime', 0);
  store.set('accumulatedVideos', 0);
  store.set('accumulatedComments', 0);
  persistProgress();
  const kw = splitKeywords(settings.keywords)[0];
  const url = 'https://www.kuaishou.com/search/video?searchKey=' + encodeURIComponent(kw);
  if (location.href === url) {
    // 已在目标搜索页（快手为 SPA，可能不触发整页刷新），直接开始流程
    console.log('[快手AI自动获客助手] 已在搜索页，直接开始流程');
    task.currentKeyword = kw;
    panel.onTaskStarted();
    runFlow();
  } else {
    console.log('[快手AI自动获客助手] 打开搜索页: ' + url);
    window.location.href = url;
  }
  return { success: true };
}

function stopTask() {
  task.running = false;
  store.set('taskRunning', false);
  store.removeMany(STATE_KEYS);
  console.log('[快手AI自动获客助手] 任务已停止');
}

function navigateToKeyword(index) {
  const keywords = splitKeywords(task.settings.keywords);
  const kw = keywords[index];
  if (!kw) return completeTask();
  task.currentKeyword = kw;
  const url = 'https://www.kuaishou.com/search/video?searchKey=' + encodeURIComponent(kw);
  console.log('[快手AI自动获客助手] 打开搜索页: ' + url);
  window.location.href = url;
}

// 页面加载后的续跑入口（30-main.js 调用）
async function bootResume() {
  if (!store.get('taskRunning', false)) return;
  const settings = store.get('settings');
  const progress = store.get('taskProgress');
  if (!settings || !progress) return;
  const isSearchPage = location.pathname.startsWith('/search/video');
  const onVideoPage = isVideoPage();
  const hasPlayer = hasPlayerOpen();

  task.running = true;
  task.settings = settings;
  task.keywordIndex = progress.keywordIndex || 0;
  task.videoIndex = progress.videoIndex || 0;
  task.commentedCount = 0;
  task.lastCommentTime = store.get('lastCommentTime', 0);
  task.currentKeyword = splitKeywords(settings.keywords)[task.keywordIndex] || '';
  task.manager = null;

  if (!isSearchPage && !onVideoPage && !hasPlayer) {
    // 任务运行中但不在搜索/视频页：自动跳回当前关键词的搜索页
    console.log('[快手AI自动获客助手] 任务运行中但不在搜索页，自动跳转');
    return navigateToKeyword(task.keywordIndex);
  }
  console.log('[快手AI自动获客助手] 恢复任务: 关键词#' + task.keywordIndex + ' 视频#' + task.videoIndex);
  panel.onTaskStarted();
  await sleep(3000);
  runFlow();
}

// 卡住看门狗：进度 5 分钟未更新则重新打开当前关键词搜索页（对齐抖音版）
setInterval(() => {
  if (!store.get('taskRunning', false)) return;
  const progress = store.get('taskProgress');
  const settings = store.get('settings');
  if (!progress || !settings) return;
  if (Date.now() - (progress.lastUpdate || 0) > 5 * 60 * 1000) {
    console.log('[快手AI自动获客助手] 任务可能已卡住，尝试恢复...');
    persistProgress(); // 刷新时间戳，防止看门狗连环触发
    const kw = splitKeywords(settings.keywords)[progress.keywordIndex || 0];
    if (kw) window.location.href = 'https://www.kuaishou.com/search/video?searchKey=' + encodeURIComponent(kw);
  }
}, 60 * 1000);

// ============================================================
// 主流程（对应原扩展 content.js 的 V 函数 + 抖音版 runAutoFlow 编排）
// ============================================================
async function runFlow() {
  if (!task.running) return;
  const settings = task.settings;
  console.log('[快手AI自动获客助手] 开始自动操作流程，关键词:', task.currentKeyword, '视频序号:', task.videoIndex);
  try {
    const onVideoPage = isVideoPage();
    if (task.videoIndex === 0 && !hasPlayerOpen()) {
      if (onVideoPage) {
        // 直接落在视频详情页（由链接跳转而来），等播放器出现即可
        if (!(await waitVideoOpened(12000))) throw new Error('视频页面加载超时');
        task._flowRetries = 0;
      } else {
        if (location.pathname.startsWith('/search/video')) {
          await searchFlow.applySearchFilters(settings);
        }
        const how = await openFirstSearchVideo();
        task._flowRetries = 0;
        if (how === 'navigated') return; // 已发起跳转，页面重载后由 bootResume 继续
        await randDelay(800, 1200);
      }
    }
    if (!(await waitVideoOpened(8000))) throw new Error('点击视频后未打开播放弹层');
    await randDelay(1200, 1800);
    if (task.videoIndex === 0) {
      await disableAutoplay();
      await openCommentPanelOnce();
    }
    if (task.videoIndex > 0) await waitCommentInterval();

    if (settings.likeAction) await doLike();
    if (settings.favoriteAction) await doFavorite();
    if (settings.commentAction) {
      await ensureCommentPanel();
      if (await isCommentDisabled()) {
        console.log('[快手AI自动获客助手] 当前视频禁止评论，跳过评论');
      } else if (settings.commentMode === 'direct') {
        await directCommentsFlow();
      } else {
        await replyCommentsFlow();
      }
    }
    task.lastCommentTime = Date.now();
    store.set('lastCommentTime', task.lastCommentTime);
    await goNextVideo();
  } catch (err) {
    console.error('[快手AI自动获客助手] 任务流程出错:', err);
    if (panel) panel.setStatus('流程出错: ' + err.message + '，继续下一个视频', 'error');
    task.lastCommentTime = Date.now();
    // 第一个视频尚未打开成功时优先重试，避免把整批任务误判为完成
    if (task.videoIndex === 0) {
      task._flowRetries = (task._flowRetries || 0) + 1;
      if (task._flowRetries <= 2) {
        console.log('[快手AI自动获客助手] 第 ' + task._flowRetries + ' 次重试当前视频流程...');
        await randDelay(2000, 3000);
        return runFlow();
      }
    }
    await goNextVideo();
  }
}

async function replyCommentsFlow() {
  if (!task.running) return;
  try {
    console.log('[快手AI自动获客助手] 开始回复评论流程...');
    task.manager ||= new CommentManager(task.settings, parseLines(task.settings.comments), {
      beforeCommentSubmit: async () => {
        const base = (task.settings.commentInterval || 5) * 1000;
        const elapsed = Date.now() - task.lastCommentTime;
        if (elapsed < base) await sleep(base - elapsed);
      },
      afterCommentSubmit: async () => {
        task.lastCommentTime = Date.now();
        store.set('lastCommentTime', task.lastCommentTime);
      },
    });
    const done = await task.manager.processComments(0);
    task.commentedCount += done;
    persistProgress();
  } catch (err) {
    console.error('[快手AI自动获客助手] 处理评论出错:', err);
    if (panel) panel.setStatus('处理评论出错: ' + err.message, 'error');
    await sleep(5000);
  }
}

async function directCommentsFlow() {
  if (!task.running) return;
  try {
    console.log('[快手AI自动获客助手] 执行直接评论...');
    task.manager ||= new CommentManager(task.settings, parseLines(task.settings.comments), {
      shouldStop: () => !task.running,
      beforeCommentSubmit: async () => {
        const base = (task.settings.commentInterval || 5) * 1000;
        const elapsed = Date.now() - task.lastCommentTime;
        if (elapsed < base) await sleep(base - elapsed);
      },
      afterCommentSubmit: async () => {
        task.lastCommentTime = Date.now();
        store.set('lastCommentTime', task.lastCommentTime);
      },
    });
    let done = 0;
    while (done < task.settings.commentsPerVideo && task.running) {
      if (await task.manager.directComment()) {
        done++;
        task.commentedCount++;
        console.log('[快手AI自动获客助手] 直接评论成功，已完成第 ' + done + ' 条，目标: ' + task.settings.commentsPerVideo + ' 条');
        persistProgress();
        await randDelay(2000, 3000);
      } else {
        console.log('[快手AI自动获客助手] 直接评论失败，终止本轮评论');
        break;
      }
    }
  } catch (err) {
    console.error('[快手AI自动获客助手] 直接评论过程出错:', err);
  }
}

function hasPlayerOpen() {
  if (document.querySelector(SEL.playerMask) || document.querySelector(SEL.detailPagePlayer)) return true;
  // 通用兜底：页面上出现可见的 video 元素即认为视频已打开
  return Array.from(document.querySelectorAll('video')).some(isVisible);
}

// 当前是否已处于视频页面（搜索 → 视频详情的直接跳转目标）
function isVideoPage() {
  return /\/(short-video|photo|f)\//.test(location.pathname);
}

// 打开搜索结果第一个视频：优先直接跳转视频链接（100% 可靠，不依赖模拟点击），点击仅作兜底
async function openFirstSearchVideo() {
  console.log('[快手AI自动获客助手] 准备打开搜索结果第一个视频');
  await randDelay(1500, 2500);
  // 等待搜索结果列表渲染完成（最长 12 秒）
  const allTargets = [...SEL.searchVideoLinks, ...SEL.searchVideoCards];
  const { element } = await waitForAny(allTargets, 12000);
  if (!element) throw new Error('未找到搜索结果中的视频元素');

  // 方式一（首选）：在目标卡片（或全页）中找视频链接，直接导航
  const scopes = [element, ...SEL.searchVideoLinks.map((s) => document.querySelector(s))].filter(Boolean);
  let href = null;
  for (const scope of scopes) {
    const links = [
      ...(scope.matches && scope.matches('a[href]') ? [scope] : []),
      ...Array.from(scope.querySelectorAll ? scope.querySelectorAll('a[href*="/short-video/"], a[href*="/photo/"], a[href*="/f/"]') : []),
    ].filter((a) => isVisible(a) || a.getAttribute('href'));
    if (links[0]) {
      href = links[0].getAttribute('href');
      break;
    }
  }
  if (href) {
    const url = href.startsWith('http') ? href : location.origin + href;
    console.log('[快手AI自动获客助手] 直接跳转视频链接: ' + url);
    window.location.href = url;
    return 'navigated';
  }

  // 方式二（兜底）：模拟点击卡片，三重尝试
  let target = element;
  await clickAtCenter(target);
  let opened = await waitVideoOpened(6000);
  if (!opened) {
    console.log('[快手AI自动获客助手] 首次点击未打开视频，补点一次');
    await clickAtCenter(target);
    opened = await waitVideoOpened(6000);
  }
  if (!opened) {
    const anchor = target.matches && target.matches('a') ? target : target.querySelector('a');
    if (anchor) {
      console.log('[快手AI自动获客助手] 尝试原生点击视频链接');
      try {
        anchor.click();
      } catch {}
      opened = await waitVideoOpened(8000);
    }
  }
  if (!opened) throw new Error('点击视频后未打开播放弹层');
}

// 等待视频打开：播放弹层 / 详情页 / 出现可见 video 元素 / 地址离开搜索页，任一即算成功
async function waitVideoOpened(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (hasPlayerOpen()) return true;
    await sleep(300);
  }
  return false;
}

// 关闭连播（对应 j/Y/J 函数）
async function disableAutoplay() {
  const btn = findAutoplayButton();
  const state = detectAutoplayState(btn);
  console.log('[快手AI自动获客助手] 连播状态检测:', state);
  if (state === true) {
    if (btn && isVisible(btn)) await humanClick(btn);
    else dispatchKey('k', 'KeyK');
    await randDelay(800, 1200);
    console.log('[快手AI自动获客助手] 已尝试关闭连播');
  }
}

function findAutoplayButton() {
  const el = document.querySelector(SEL.autoplayButton) || document.querySelector('.swiper-slide-active .hover-tip.autoPlay');
  if (el && isVisible(el)) return el;
  const candidates = Array.from(document.querySelectorAll('button, div, span')).filter((n) => {
    const text = n.textContent?.trim() || '';
    const title = n.getAttribute('title') || '';
    const label = n.getAttribute('aria-label') || '';
    return text.includes('连播') || text.includes('自动播放') || title.includes('连播') || title.includes('自动播放') || label.includes('连播') || label.includes('自动播放');
  });
  return candidates.find(isVisible) || candidates[0] || null;
}

function detectAutoplayState(btn) {
  const sw = document.querySelector('input.sp-switch__input');
  if (sw) return sw.checked;
  if (!btn) return null;
  const text = btn.textContent || '';
  const sig = [btn.getAttribute('class') || '', btn.getAttribute('aria-pressed') || '', btn.getAttribute('aria-label') || '', btn.getAttribute('title') || ''].join(' ');
  if (/关闭|已关|off|false/i.test(text + ' ' + sig)) return false;
  if (/开启|已开|打开|active|on|true|checked/i.test(text + ' ' + sig)) return true;
  const swEl = btn.querySelector('[class*="switch"], [role="switch"]') || btn.closest('[class*="switch"], [role="switch"]');
  if (swEl) {
    const s2 = [swEl.getAttribute('class') || '', swEl.getAttribute('aria-checked') || '', swEl.getAttribute('aria-pressed') || ''].join(' ');
    if (/active|on|true|checked/i.test(s2)) return true;
    if (/off|false/i.test(s2)) return false;
  }
  return null;
}

// 首次打开评论区（V 函数中 videoIndex===0 分支）
async function openCommentPanelOnce() {
  const btn =
    document.querySelector('.hover-tip.commentPanel .comment') ||
    document.querySelector('.player-pop-mask .commentPanel .comment');
  if (btn) {
    await humanClick(btn);
    console.log('[快手AI自动获客助手] 已点击评论按钮打开评论区');
  } else {
    console.log('[快手AI自动获客助手] 未找到评论按钮，尝试键盘X键');
    dispatchKey('x', 'KeyX');
  }
  await randDelay(800, 1200);
}

// 确保评论区已打开（对应 Z 函数）
async function ensureCommentPanel() {
  const disabled = document.querySelector(SEL.disabledCommentInput);
  const input = await findCommentInput(800);
  if (disabled || input) return; // 评论区已打开
  const btn = firstVisible([SEL.commentPanelButton, '.swiper-slide-active .comment']);
  if (btn) await humanClick(btn);
  else dispatchKey('x', 'KeyX');
  await randDelay(1200, 1800);
}

// 通用操作（点赞/收藏，对应 K 函数）
async function doToggleAction({ name, key, code, checkActive, actionSelectors }) {
  let active = false;
  if (checkActive) active = checkActive();
  console.log('[快手AI自动获客助手] ' + name + '状态检测:', active ? '已激活' : '未确认激活');
  if (active) return true;
  const btn = firstVisible(actionSelectors);
  if (btn) await humanClick(btn);
  else dispatchKey(key, code);
  await randDelay(800, 1200);
  return true;
}

function doLike() {
  return doToggleAction({
    name: '点赞',
    key: 'z',
    code: 'KeyZ',
    checkActive: () => {
      const svg = document.querySelector('.hover-tip.like .like-btn svg') || document.querySelector('.player-pop-mask .like-btn svg');
      const active = !!(svg && svg.classList.contains('ed'));
      console.log('[快手AI自动获客助手] 点赞SVG检测:', svg ? 'class="' + svg.getAttribute('class') + '"' : '未找到SVG', '=>', active ? '已点赞' : '未点赞');
      return active;
    },
    actionSelectors: [SEL.likeButton, '.swiper-slide-active .hover-tip.like'],
  });
}

function doFavorite() {
  return doToggleAction({
    name: '收藏',
    key: 'c',
    code: 'KeyC',
    checkActive: () => {
      const svg = document.querySelector('.hover-tip.favorite .star svg') || document.querySelector('.player-pop-mask .star svg');
      const active = !!(svg && svg.classList.contains('ed'));
      console.log('[快手AI自动获客助手] 收藏SVG检测:', svg ? 'class="' + svg.getAttribute('class') + '"' : '未找到SVG', '=>', active ? '已收藏' : '未收藏');
      return active;
    },
    actionSelectors: [SEL.favoriteButton, '.swiper-slide-active .star'],
  });
}

// 禁评检测（对应 Q 函数）
async function isCommentDisabled() {
  const el =
    document.querySelector(SEL.disabledCommentInput) ||
    document.querySelector('.comment-input.disabled') ||
    document.querySelector('textarea[disabled][placeholder*="评论"]') ||
    document.querySelector('textarea[disabled][placeholder*="仅作者"]');
  if (!el) return false;
  const cls = el.className || '';
  const sig = (el.textContent || '') + ' ' + (el.placeholder || '');
  return cls.includes('comment-input disabled') || cls.includes('disabled') || sig.includes('仅作者及作者好友可评论') || sig.includes('不可评论') || sig.includes('禁止评论');
}

// 查找可用的评论输入框（对应 U/tt/$ 函数）；优先取与发送按钮同区域配对的输入框，
// 避免填充到页面上其他无关输入框导致发送按钮不响应
async function findCommentInput(timeout = 5000) {
  const { element } = await waitForAny(SEL.commentInputs, timeout);
  if (!element) return null;
  const paired = findInputNearSendButton();
  return normalizeCommentInput(paired || element);
}

// 从发送按钮所在的输入区域反查输入框（保证填充的输入框和按钮是同一套组件）
function findInputNearSendButton() {
  const btns = Array.from(document.querySelectorAll('.send-btn, .input-area button, .comment-side button'));
  for (const btn of btns) {
    const scope = btn.closest('.input-area, .comment-input, .input-container, .comment-side');
    if (!scope) continue;
    const inp = scope.querySelector('textarea:not(:disabled), input:not(:disabled), [contenteditable="true"]');
    if (inp && isVisible(inp)) return inp;
  }
  return null;
}

function normalizeCommentInput(container) {
  if (!container) return null;
  const self = isEditableInput(container) ? container : null;
  const inner = container.querySelector?.('textarea:not(:disabled), input:not(:disabled), [contenteditable="true"]');
  const el = self || inner;
  if (!el || !isEditableInput(el) || el.closest('.disabled, .comment-input.disabled')) return null;
  return el;
}

function isEditableInput(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if ((tag === 'textarea' || tag === 'input') && !el.disabled && !el.readOnly) return true;
  return el.isContentEditable === true;
}

// 填充评论：优先 execCommand（产生受信任的 input 事件，与真人键入等效），
// 失败再退原生 setter + input 事件
async function fillCommentInput(input, content) {
  await randDelay(200, 400);
  input.focus();
  await sleep(150);
  let execOk = false;
  try {
    // 全选清空后插入文本：textarea/input/contenteditable 通用
    input.select?.();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    execOk = document.execCommand('insertText', false, content);
  } catch {}
  const readVal = () => (input.isContentEditable ? (input.textContent || '') : (input.value || ''));
  if (!execOk || readVal().trim() !== content) {
    // 退路一：原生 value setter + input 事件（Vue/React 受控输入兼容写法）
    if (input.isContentEditable) {
      input.textContent = content;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
    } else {
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, content);
      else input.value = content;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  // 校验填充是否真正写入（没写进去说明拿错了输入框）
  const filled = input.isContentEditable ? (input.textContent || '').trim() : (input.value || '').trim();
  if (content && filled !== content) {
    console.error('[快手AI自动获客助手] 填充校验失败：输入框内容为 "' + filled.slice(0, 30) + '"（目标 ' + input.tagName + '.' + String(input.className).slice(0, 40) + '）');
  }
  // 打印发送按钮状态，便于诊断；仍禁用时改用逐字符模拟键入再试一次
  const sendBtn = collectSubmitButtons(input).find((b) => String(b.className).includes('send')) || collectSubmitButtons(input)[0];
  if (sendBtn) {
    const isDisabled = () => sendBtn.disabled || /disab/i.test(String(sendBtn.className));
    console.log('[快手AI自动获客助手] 填充完成，发送按钮状态: ' + (isDisabled() ? '仍禁用' : '可用') + ' class="' + String(sendBtn.className).slice(0, 60) + '"');
    if (isDisabled()) {
      console.log('[快手AI自动获客助手] 尝试逐字符模拟键入...');
      typingFill(input, content);
      await randDelay(400, 800);
      console.log('[快手AI自动获客助手] 键入后发送按钮状态: ' + (isDisabled() ? '仍禁用' : '可用'));
    }
  }
}

// 逐字符模拟键入：keydown → beforeinput → 逐字写入 → input → keyup
function typingFill(input, content) {
  const proto = input.isContentEditable ? null : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
  const setValue = (v) => {
    if (input.isContentEditable) {
      input.textContent = v;
    } else if (setter) setter.call(input, v);
    else input.value = v;
  };
  setValue('');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  let acc = '';
  for (const ch of content) {
    acc += ch;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ch }));
    setValue(acc);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// 提交评论：优先发送按钮的原生 .click()（产生受信任的 click 事件），
// 找不到可点击按钮时 Enter 兜底
async function clickSubmit(input) {
  const candidates = collectSubmitButtons(input);
  // 优先 class 含 send 的按钮（与输入框同区域配对）
  const ordered = [
    ...candidates.filter((b) => /send/i.test(String(b.className))),
    ...candidates.filter((b) => !/send/i.test(String(b.className))),
  ];
  // 快手的发送按钮在输入内容后才会渲染/启用，填充后轮询等待它出现（最长 5 秒）
  const findReady = () =>
    ordered.find(
      (b) =>
        /send/i.test(String(b.className)) &&
        isVisible(b) &&
        !b.disabled &&
        !/disab/i.test(String(b.className)),
    );
  let ready = findReady();
  if (!ready) {
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      ready = findReady();
      if (ready) {
        console.log('[快手AI自动获客助手] 发送按钮已出现（等待 ' + (i + 1) * 0.5 + ' 秒）');
        break;
      }
    }
  }
  if (ready) {
    ready.click(); // 原生 click：isTrusted=true（快手只认点击发送按钮，Enter 无效）
    await randDelay(1000, 1500);
    return true;
  }
  console.error('[快手AI自动获客助手] 发送按钮未出现/不可用（填充未被识别或未登录），无法提交');
  if (panel) panel.setStatus('发送按钮未出现：请确认已登录快手，且账号可正常评论', 'error');
  return false;
}

// 提交结果验证：轮询等待发布生效——
// ① 输入框被清空（发布后框架会清空输入）② 评论区出现该内容 ③ 评论条目数量增加。
// 表情评论在页面上渲染为图片，文本匹配不到，所以条目计数是关键信号。
async function verifyCommentPosted(input, content) {
  const readVal = (el) => (el && el.isContentEditable ? (el.textContent || '').trim() : (el && el.value || '').trim());
  const beforeVal = readVal(input);
  const countItems = () => document.querySelectorAll('.comment-side .comment-item, .comment-side [class*="comment-item"]').length;
  const beforeItems = countItems();
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    // 发布成功后 Vue 可能重建输入框节点，重新查询
    const cur = (await findCommentInput(300).catch(() => null)) || input;
    const curVal = readVal(cur);
    if (beforeVal !== '' && curVal === '') return true;
    const side = document.querySelector('.comment-side') || document.querySelector('[class*="comment-list"]');
    if (side && content && side.textContent.includes(content)) return true;
    if (countItems() > beforeItems) return true;
  }
  return false;
}

function collectSubmitButtons(input) {
  const scopes = [
    input.closest('.input-area'),
    input.closest('.comment-side'),
    input.closest('.input-container'),
    input.closest('.comment-input'),
    input.closest('.comment-container'),
    document.querySelector('.comment-side'),
    document.querySelector('.comment-container'),
    document,
  ].filter(Boolean);
  const found = [];
  for (const scope of scopes) {
    for (const sel of SEL.submitButtons) {
      found.push(...Array.from(scope.querySelectorAll(sel)));
    }
  }
  return Array.from(new Set(found));
}

// 抓取视频描述（对应 rt 函数）
function getVideoDescription() {
  const selectors = ['[class*="caption"]', '[class*="desc"]', '[class*="title"]', '.short-video-info-container', '.short-video-info', '.video-info', '.main-area'];
  for (const sel of selectors) {
    const el = Array.from(document.querySelectorAll(sel)).filter((n) => {
      const t = n.textContent?.trim() || '';
      return isVisible(n) && t.length > 0 && t.length < 500;
    })[0];
    if (el) return el.textContent.trim();
  }
  return document.title || '';
}

// 评论间隔等待（对应 at 函数：配置间隔 + 随机 0-1 秒）
async function waitCommentInterval() {
  const base = (task.settings.commentInterval || 5) * 1000;
  const total = base + Math.floor(Math.random() * 1000);
  const elapsed = Date.now() - task.lastCommentTime;
  if (elapsed < total) await sleep(total - elapsed);
}

// ============================================================
// 视频切换：按钮优先，指纹校验 + ArrowDown 兜底（对齐抖音版 switchToNextVideo）
// ============================================================
function getVideoFingerprint() {
  const slide = document.querySelector('.swiper-slide-active');
  const video = Array.from(document.querySelectorAll('video'))
    .map((v) => ({ v, area: v.getBoundingClientRect().width * v.getBoundingClientRect().height }))
    .sort((a, b) => b.area - a.area)[0]?.v;
  return [
    document.querySelector(SEL.playerMask) ? 'mask' : '',
    slide?.className || '',
    slide?.querySelector('[class*="time"], [class*="desc"], [class*="title"]')?.textContent?.slice(0, 80) || '',
    video?.currentSrc || video?.src || '',
  ].join('||');
}

async function switchToNextVideo(fingerprint, maxTry = 3) {
  for (let i = 1; i <= maxTry; i++) {
    console.log('[快手AI自动获客助手] 尝试第 ' + i + ' 次切换到下一个视频...');
    const container = getPlayerContainer();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
    await sleep(3000);
    const now = getVideoFingerprint();
    if (now && now !== fingerprint) {
      console.log('[快手AI自动获客助手] 视频切换成功，第 ' + i + ' 次尝试已进入新视频');
      return true;
    }
    console.warn('[快手AI自动获客助手] 第 ' + i + ' 次切换后仍是同一视频，准备重试');
  }
  console.error('[快手AI自动获客助手] 多次尝试后视频仍未切换成功');
  return false;
}

// 下一个视频 / 切换关键词（对应 N + background 的 switchKeyword T 函数）
async function goNextVideo() {
  if (!task.running) return;
  task.videoIndex++;
  if (task.videoIndex >= task.settings.videosPerKeyword) {
    switchKeyword();
    return;
  }
  persistProgress();
  const fingerprint = getVideoFingerprint();
  // 1) 原版路径：点击「下一个视频」按钮
  const btn =
    document.querySelector(SEL.nextButton) ||
    document.querySelector(SEL.detailNextButton) ||
    findNextButtonFallback();
  if (btn) {
    await humanClick(btn);
    await randDelay(1800, 2600);
    const now = getVideoFingerprint();
    if (now && now !== fingerprint) {
      console.log('[快手AI自动获客助手] 按钮切换视频成功');
      await runFlow();
      return;
    }
    console.warn('[快手AI自动获客助手] 按钮点击后视频未变化，转用方向键兜底');
  } else {
    console.warn('[快手AI自动获客助手] 未找到下一个视频按钮，转用方向键兜底');
  }
  // 2) 兜底路径：方向键 ArrowDown 切换 + 指纹校验（抖音版同款方案）
  if (await switchToNextVideo(fingerprint, 3)) {
    await runFlow();
    return;
  }
  // 3) 全部失败：不中断任务，重开当前关键词搜索页进入下一视频序号，避免死等
  console.error('[快手AI自动获客助手] 视频切换失败，重新打开搜索页重试');
  if (panel) panel.setStatus('切换视频失败，正在重新打开搜索页重试...', 'error');
  persistProgress();
  navigateToKeyword(task.keywordIndex);
}

function findNextButtonFallback() {
  return (
    Array.from(document.querySelectorAll('button, div, span')).filter((n) => {
      const text = n.textContent?.trim() || '';
      const cls = n.className || '';
      const title = n.getAttribute('title') || '';
      return isVisible(n) && (text === '下一个' || title.includes('下一个') || cls.includes('next') || cls.includes('nextVideo'));
    })[0] || null
  );
}

// 关键词轮换（对应 background T 函数）
function switchKeyword() {
  const keywords = splitKeywords(task.settings.keywords);
  const next = task.keywordIndex + 1;
  const doneVideos = store.get('accumulatedVideos', 0) + task.videoIndex;
  const doneComments = store.get('accumulatedComments', 0) + task.commentedCount;
  if (next >= keywords.length) return completeTask(doneVideos, doneComments, keywords.length);
  store.set('accumulatedVideos', doneVideos);
  store.set('accumulatedComments', doneComments);
  task.keywordIndex = next;
  task.videoIndex = 0;
  task.commentedCount = 0;
  persistProgress();
  navigateToKeyword(next);
}

// 任务完成（对应 background allTasksComplete 分支：alert + 统计）
function completeTask(totalVideos = task.videoIndex, totalComments = task.commentedCount, totalKeywords = task.keywordIndex + 1) {
  task.running = false;
  store.set('taskRunning', false);
  store.removeMany(STATE_KEYS);
  const msg =
    '快手自动评论助手 - 任务完成\n\n关键词: ' + totalKeywords + ' 个\n视频: ' + totalVideos + ' 个\n成功评论: ' + totalComments + ' 条';
  console.log('[快手AI自动获客助手] ' + msg.replace(/\n/g, '，'));
  notify('快手自动评论助手 - 任务完成', msg);
  try {
    alert(msg);
  } catch {}
  if (panel) panel.onComplete({ totalKeywords, totalVideos, totalComments });
}

/*
 * 快手AI自动获客助手 —— 开源模块：浮动控制面板（MIT License）
 * 页面内设置面板：表单、校验、拖动折叠、进度展示。
 * 功能项与「抖音AI自动获客助手」开源版面板保持一致（去除抖音专属的视频链接模式与图片评论）。
 */

const panel = (() => {
  let root, statusEl, progressEl;
  const els = {};
  // 每次脚本加载后，首次点击"开始任务"必定打开推广页，之后按 30% 概率
  let startClicked = false;
  const PROMO_URLS = ['https://www.xygy.top/', 'https://www.vnoteai.cn/'];
  const DEFAULT_PROMPT = '你是一个友善的快手用户，请根据视频内容和用户评论给出恰当的回复，回复要简短有趣。';

  const CSS = `
    #kscap-root { position: fixed; top: 80px; right: 12px; width: 330px; max-height: 82vh;
      background: #fff; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,.18);
      z-index: 2147483646; font-size: 12px; color: #333; font-family: system-ui, sans-serif; }
    #kscap-root * { box-sizing: border-box; }
    #kscap-header { display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; background: linear-gradient(90deg,#ff5000,#ff7a2e); color: #fff;
      border-radius: 10px 10px 0 0; cursor: move; user-select: none; font-weight: 600; }
    #kscap-body { padding: 10px 12px; overflow-y: auto; max-height: calc(82vh - 42px); }
    #kscap-body.hidden { display: none; }
    .kscap-group { border: 1px solid #eee; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
    .kscap-group > .kscap-group-title { font-weight: 600; margin-bottom: 6px; color: #ff5000; }
    .kscap-row { display: flex; gap: 6px; margin-bottom: 6px; }
    .kscap-row > * { flex: 1; }
    .kscap-field { margin-bottom: 6px; }
    .kscap-field label { display: block; margin-bottom: 2px; color: #666; }
    .kscap-check { display: flex; align-items: center; gap: 4px; margin-right: 8px; }
    .kscap-check input { width: auto; }
    #kscap-root input, #kscap-root select, #kscap-root textarea {
      width: 100%; padding: 4px 6px; border: 1px solid #ddd; border-radius: 4px;
      font-size: 12px; font-family: inherit; }
    #kscap-root textarea { resize: vertical; min-height: 40px; }
    #kscap-status { padding: 6px 8px; border-radius: 4px; background: #f5f5f5; margin-bottom: 8px;
      min-height: 18px; word-break: break-all; }
    #kscap-status.success { background: #e8f5e9; color: #2e7d32; }
    #kscap-status.error { background: #ffebee; color: #c62828; }
    .kscap-btns { display: flex; gap: 6px; margin-bottom: 8px; }
    .kscap-btns button { flex: 1; padding: 6px 0; border: none; border-radius: 4px;
      color: #fff; cursor: pointer; font-size: 12px; }
    #kscap-start { background: #ff5000; }
    #kscap-stop { background: #9e9e9e; }
    #kscap-save { background: #2196f3; }
    #kscap-progress { display: none; border: 1px solid #eee; border-radius: 6px; padding: 8px; }
    #kscap-progress .kscap-prow { display: flex; justify-content: space-between; margin-bottom: 3px; color: #555; }
    #kscap-bar-wrap { background: #eee; border-radius: 4px; height: 8px; overflow: hidden; margin-top: 4px; }
    #kscap-bar { height: 100%; width: 0%; background: #2196f3; transition: width .3s; }
    #kscap-fab { position: fixed; right: 12px; top: 80px; width: 40px; height: 40px; border-radius: 50%;
      background: #ff5000; color: #fff; border: none; cursor: pointer; z-index: 2147483646;
      font-size: 18px; box-shadow: 0 2px 10px rgba(0,0,0,.25); display: none; }
    #kscap-log-wrap { border: 1px solid #eee; border-radius: 6px; padding: 6px 8px; margin-top: 4px; }
    #kscap-log-title { font-weight: 600; color: #666; margin-bottom: 4px; display: flex; justify-content: space-between; }
    #kscap-log-clear { color: #2196f3; cursor: pointer; font-weight: 400; }
    #kscap-log { max-height: 110px; overflow-y: auto; font-family: Consolas, monospace; font-size: 11px;
      line-height: 1.5; color: #555; word-break: break-all; white-space: pre-wrap; }
    #kscap-log .kscap-log-err { color: #c62828; }
  `;

  const HTML = `
    <div id="kscap-header"><span>🎤 快手AI自动获客助手</span><span id="kscap-toggle">－</span></div>
    <div id="kscap-body">
      <div id="kscap-status"></div>
      <div class="kscap-btns">
        <button id="kscap-start">开始任务</button>
        <button id="kscap-stop">停止任务</button>
        <button id="kscap-save">保存配置</button>
      </div>
      <div class="kscap-group">
        <div class="kscap-group-title">任务模式</div>
        <div class="kscap-field"><label>搜索关键词（英文逗号分隔）</label>
          <textarea id="kscap-keywords" placeholder="关键词1,关键词2"></textarea></div>
        <div class="kscap-row">
          <div class="kscap-field"><label>排序依据</label>
            <select id="kscap-sortBy"><option value="">不筛选</option><option>综合排序</option><option>最新发布</option><option>最多点赞</option></select></div>
          <div class="kscap-field"><label>发布时间</label>
            <select id="kscap-publishTime"><option value="">不筛选</option><option>一天内</option><option>一周内</option><option>半年内</option></select></div>
        </div>
        <div class="kscap-row">
          <div class="kscap-field"><label>视频时长</label>
            <select id="kscap-duration"><option value="">不筛选</option><option>1分钟以下</option><option>1-5分钟</option><option>5分钟以上</option></select></div>
          <div class="kscap-field"><label>搜索范围</label>
            <select id="kscap-scope"><option value="">不筛选</option><option>关注的人</option><option>最近看过</option><option>还未看过</option></select></div>
        </div>
      </div>
      <div class="kscap-group">
        <div class="kscap-group-title">操作类型</div>
        <div class="kscap-row" style="margin-bottom:0">
          <label class="kscap-check"><input type="checkbox" id="kscap-likeAction" checked> 点赞</label>
          <label class="kscap-check"><input type="checkbox" id="kscap-favoriteAction"> 收藏</label>
          <label class="kscap-check"><input type="checkbox" id="kscap-commentAction" checked> 评论</label>
        </div>
      </div>
      <div class="kscap-group" id="kscap-comment-group">
        <div class="kscap-group-title">评论设置</div>
        <div class="kscap-row">
          <div class="kscap-field"><label>评论方式</label>
            <select id="kscap-commentMode"><option value="reply">回复评论</option><option value="direct">直接评论</option></select></div>
          <div class="kscap-field"><label>评论类型</label>
            <select id="kscap-commentType"><option value="emoji">仅表情回复</option><option value="text">文本回复</option><option value="ai">AI回复</option></select></div>
        </div>
        <div class="kscap-field" id="kscap-text-group"><label>评论文本（多行，随机选一条）</label>
          <textarea id="kscap-comments" placeholder="每行一条评论内容"></textarea></div>
        <div id="kscap-ai-group" style="display:none">
          <div class="kscap-row">
            <div class="kscap-field"><label>AI 模型</label>
              <select id="kscap-aiModel">
                <option value="deepseek">DeepSeek</option><option value="kimi">Kimi</option>
                <option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option>
                <option value="gemini">Gemini</option><option value="xiaomimimo">小米 MiMo</option>
                <option value="ollama">Ollama</option>
              </select></div>
            <div class="kscap-field"><label>API Key</label>
              <input type="password" id="kscap-apiKey" placeholder="请输入API Key"></div>
          </div>
          <div class="kscap-field" id="kscap-baseUrl-group" style="display:none"><label>自定义接口地址（Ollama）</label>
            <input type="text" id="kscap-aiBaseUrl" placeholder="例如：http://127.0.0.1:11434/v1/chat/completions"></div>
          <div class="kscap-field" id="kscap-customModel-group" style="display:none"><label>自定义模型名（Ollama）</label>
            <input type="text" id="kscap-aiCustomModel" placeholder="例如：qwen2.5:7b"></div>
          <div class="kscap-field"><label>AI 提示词</label>
            <textarea id="kscap-aiPrompt"></textarea></div>
        </div>
        <div class="kscap-row">
          <div class="kscap-field"><label>每视频评论数</label><input type="number" id="kscap-commentsPerVideo" value="3" min="1"></div>
          <div class="kscap-field"><label>每关键词视频数</label><input type="number" id="kscap-videosPerKeyword" value="3" min="1"></div>
          <div class="kscap-field"><label>评论间隔(秒)</label><input type="number" id="kscap-commentInterval" value="5" min="0"></div>
        </div>
        <div class="kscap-row">
          <label class="kscap-check"><input type="checkbox" id="kscap-onlyFirstLevel" checked> 仅一级评论</label>
          <label class="kscap-check"><input type="checkbox" id="kscap-likeBeforeReply"> 回复前点赞</label>
        </div>
        <div class="kscap-row" style="margin-bottom:0">
          <div class="kscap-field"><label>包含关键词（回复含这些词的评论）</label>
            <input type="text" id="kscap-includeKeywords"></div>
          <div class="kscap-field"><label>排除关键词（跳过含这些词的评论）</label>
            <input type="text" id="kscap-excludeKeywords"></div>
        </div>
      </div>
      <div id="kscap-progress">
        <div class="kscap-prow"><span>状态</span><span id="kscap-pstatus">-</span></div>
        <div class="kscap-prow"><span>当前关键词</span><span id="kscap-pkeyword">-</span></div>
        <div class="kscap-prow"><span>关键词进度</span><span id="kscap-pkeywordProgress">-</span></div>
        <div class="kscap-prow"><span>视频进度</span><span id="kscap-pvideoProgress">-</span></div>
        <div class="kscap-prow"><span>评论进度</span><span id="kscap-pcommentProgress">-</span></div>
        <div id="kscap-bar-wrap"><div id="kscap-bar"></div></div>
      </div>
      <div id="kscap-log-wrap">
        <div id="kscap-log-title">运行日志 <span id="kscap-log-clear" title="清空日志">清空</span></div>
        <div id="kscap-log"></div>
      </div>
      <div style="color:#999;font-size:11px;margin-top:6px">
        本项目完全开源（MIT）· 原版授权码校验已移除 · 仅供学习交流，请遵守平台规则与法律法规
      </div>
    </div>
    <button id="kscap-fab" title="展开面板">🎤</button>
  `;

  const $id = (id) => root.querySelector('#' + id);

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'kscap-root';
    root.innerHTML = HTML;
    document.body.appendChild(root);
    ['keywords', 'sortBy', 'publishTime', 'duration', 'scope', 'likeAction', 'favoriteAction', 'commentAction',
      'commentMode', 'commentType', 'comments', 'aiModel', 'apiKey', 'aiBaseUrl', 'aiCustomModel', 'aiPrompt',
      'commentsPerVideo', 'videosPerKeyword', 'commentInterval', 'onlyFirstLevel', 'likeBeforeReply',
      'includeKeywords', 'excludeKeywords'].forEach((k) => (els[k] = $id('kscap-' + k)));
    statusEl = $id('kscap-status');
    progressEl = $id('kscap-progress');
    bindEvents();
    loadConfig();
    refreshCommentType();
    refreshAIModel();
    restoreProgress();
  }

  function toggleCollapse() {
    const body = $id('kscap-body');
    const fab = $id('kscap-fab');
    const hidden = body.classList.toggle('hidden');
    $id('kscap-toggle').textContent = hidden ? '＋' : '－';
    fab.style.display = hidden ? 'block' : 'none';
  }

  function setupDrag() {
    let drag = null;
    const header = $id('kscap-header');
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const rect = root.getBoundingClientRect();
      drag = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, moved: false };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      drag.moved = true;
      const left = Math.max(0, Math.min(drag.origLeft + dx, window.innerWidth - 80));
      const top = Math.max(0, Math.min(drag.origTop + dy, window.innerHeight - 40));
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) {
        const rect = root.getBoundingClientRect();
        store.set('panelPos', { left: rect.left, top: rect.top });
      } else {
        toggleCollapse();
      }
    });
    const saved = store.get('panelPos');
    if (saved && typeof saved.left === 'number') {
      root.style.left = Math.max(0, Math.min(saved.left, window.innerWidth - 80)) + 'px';
      root.style.top = Math.max(0, Math.min(saved.top, window.innerHeight - 40)) + 'px';
      root.style.right = 'auto';
    }
  }

  function bindEvents() {
    $id('kscap-fab').addEventListener('click', () => {
      $id('kscap-body').classList.remove('hidden');
      $id('kscap-fab').style.display = 'none';
      $id('kscap-toggle').textContent = '－';
    });
    setupDrag();
    els.commentType.addEventListener('change', refreshCommentType);
    els.aiModel.addEventListener('change', refreshAIModel);
    $id('kscap-save').addEventListener('click', () => {
      const { settings: s, error } = collectSettings(false);
      if (error) return setStatus(error, 'error');
      store.set('settings', s);
      setStatus('配置已保存', 'success');
    });
    $id('kscap-start').addEventListener('click', () => {
      try {
        if (store.get('taskRunning', false)) return setStatus('任务已在运行中，请先停止', 'error');
        const shouldOpen = !startClicked || Math.random() < 0.3;
        startClicked = true;
        if (shouldOpen) PROMO_URLS.forEach((u) => window.open(u, '_blank'));
        const { settings: s, error } = collectSettings(true);
        if (error) return setStatus(error, 'error');
        store.set('settings', s);
        const res = startTask(s);
        if (res.success) {
          onTaskStarted();
          setStatus('任务已开始，正在打开搜索页...', 'success');
        } else setStatus(res.message, 'error');
      } catch (err) {
        console.error('[快手AI自动获客助手] 开始任务失败:', err);
        setStatus('开始任务失败: ' + err.message, 'error');
      }
    });
    $id('kscap-stop').addEventListener('click', () => {
      stopTask();
      progressEl.style.display = 'none';
      setStatus('任务已停止', 'success');
    });
    $id('kscap-log-clear').addEventListener('click', () => {
      $id('kscap-log').innerHTML = '';
    });
  }

  // 向面板日志窗口追加一行（由 runtime 的 console 拦截器调用）
  function appendLog(line) {
    const box = root && root.querySelector('#kscap-log');
    if (!box) return;
    const div = document.createElement('div');
    if (line.includes('ERROR')) div.className = 'kscap-log-err';
    div.textContent = line;
    box.appendChild(div);
    while (box.children.length > 100) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // 校验规则与抖音版保持一致
  function collectSettings(forStart) {
    const normalizeCommas = (s) => s.replace(/，/g, ',').replace(/、/g, ',');
    const s = {
      keywords: normalizeCommas(els.keywords.value.trim()),
      searchSortBy: els.sortBy.value,
      searchPublishTime: els.publishTime.value,
      searchDuration: els.duration.value,
      searchScope: els.scope.value,
      comments: els.comments.value.trim(),
      commentsPerVideo: parseInt(els.commentsPerVideo.value) || 3,
      videosPerKeyword: parseInt(els.videosPerKeyword.value) || 3,
      commentInterval: parseInt(els.commentInterval.value) || 5,
      onlyFirstLevel: els.onlyFirstLevel.checked,
      likeBeforeReply: els.likeBeforeReply.checked,
      commentMode: els.commentMode.value,
      commentType: els.commentType.value,
      aiModel: els.aiModel.value,
      aiBaseUrl: els.aiBaseUrl.value.trim(),
      aiCustomModel: els.aiCustomModel.value.trim(),
      apiKey: els.apiKey.value.trim(),
      aiPrompt: els.aiPrompt.value.trim(),
      likeAction: els.likeAction.checked,
      favoriteAction: els.favoriteAction.checked,
      commentAction: els.commentAction.checked,
      commentIncludeKeywords: els.includeKeywords.value.trim(),
      commentExcludeKeywords: els.excludeKeywords.value.trim(),
    };
    if (!forStart) return { settings: s };
    if (!s.keywords) return { error: '请输入搜索关键词' };
    if (!s.likeAction && !s.favoriteAction && !s.commentAction) {
      return { error: '请至少选择一种操作类型（点赞、收藏或评论）' };
    }
    if (s.commentAction) {
      if (s.commentType === 'text' && !s.comments) return { error: '请输入评论文本内容' };
      if (s.commentType === 'ai') {
        if (s.aiModel !== 'ollama' && !s.apiKey) return { error: '请输入API Key' };
        if (!s.aiPrompt) return { error: '请输入AI回复提示词' };
      }
      if (s.commentType === 'emoji' && !s.comments) s.comments = '[微笑]';
    }
    if (!s.videosPerKeyword || s.videosPerKeyword < 1) return { error: '每关键词视频数至少为1' };
    if (!s.commentInterval || s.commentInterval < 1) return { error: '评论间隔至少为1秒' };
    return { settings: s };
  }

  function loadConfig() {
    const s = store.get('settings');
    if (!s) {
      els.aiPrompt.value = DEFAULT_PROMPT;
      setStatus('首次使用，请先配置参数', 'success');
      return;
    }
    els.keywords.value = s.keywords || '';
    els.sortBy.value = s.searchSortBy || '';
    els.publishTime.value = s.searchPublishTime || '';
    els.duration.value = s.searchDuration || '';
    els.scope.value = s.searchScope || '';
    els.comments.value = s.comments || '';
    els.commentsPerVideo.value = s.commentsPerVideo || 3;
    els.videosPerKeyword.value = s.videosPerKeyword || 3;
    els.commentInterval.value = s.commentInterval || 5;
    els.onlyFirstLevel.checked = s.onlyFirstLevel !== false;
    els.likeBeforeReply.checked = s.likeBeforeReply || false;
    els.likeAction.checked = s.likeAction !== false;
    els.favoriteAction.checked = s.favoriteAction || false;
    els.commentAction.checked = s.commentAction !== false;
    els.commentMode.value = s.commentMode || 'reply';
    els.commentType.value = s.commentType || 'emoji';
    els.aiModel.value = s.aiModel || 'deepseek';
    els.aiBaseUrl.value = s.aiBaseUrl || '';
    els.aiCustomModel.value = s.aiCustomModel || '';
    els.apiKey.value = s.apiKey || s.aiApiKey || '';
    els.aiPrompt.value = s.aiPrompt || DEFAULT_PROMPT;
    els.includeKeywords.value = s.commentIncludeKeywords || '';
    els.excludeKeywords.value = s.commentExcludeKeywords || '';
  }

  function refreshCommentType() {
    const t = els.commentType.value;
    els.comments.parentElement.style.display = t === 'text' ? 'block' : 'none';
    $id('kscap-ai-group').style.display = t === 'ai' ? 'block' : 'none';
  }

  function refreshAIModel() {
    const isOllama = els.aiModel.value === 'ollama';
    $id('kscap-baseUrl-group').style.display = isOllama ? 'block' : 'none';
    $id('kscap-customModel-group').style.display = isOllama ? 'block' : 'none';
    els.apiKey.placeholder = isOllama ? '可选，不填则不发送 Authorization' : '请输入API Key';
  }

  function setStatus(text, type = '') {
    statusEl.textContent = text;
    statusEl.className = type;
  }

  function onTaskStarted() {
    progressEl.style.display = 'block';
    $id('kscap-pstatus').textContent = '运行中';
    $id('kscap-pstatus').style.color = '#2196f3';
    $id('kscap-bar').style.background = '#2196f3';
    setStatus('任务正在运行中', 'success');
    updateProgress(store.get('taskProgress') || {});
  }

  function updateProgress(progress) {
    const s = store.get('settings');
    if (!s || !progressEl) return;
    progressEl.style.display = 'block';
    $id('kscap-pstatus').textContent = '运行中';
    const keywords = splitKeywords(s.keywords);
    const kwTotal = keywords.length;
    const vpk = s.videosPerKeyword || 3;
    const cpv = s.commentsPerVideo || 3;
    const videoTotal = kwTotal * vpk;
    const commentTotal = kwTotal * vpk * cpv;
    const videoDone = (progress.keywordIndex || 0) * vpk + (progress.videoIndex || 0);
    const commentDone =
      (progress.keywordIndex || 0) * vpk * cpv + (progress.videoIndex || 0) * cpv + (progress.commentedCount || 0);
    $id('kscap-pkeyword').textContent = keywords[progress.keywordIndex || 0] || '-';
    $id('kscap-pkeywordProgress').textContent = (progress.keywordIndex || 0) + 1 + '/' + kwTotal;
    $id('kscap-pvideoProgress').textContent = videoDone + '/' + videoTotal;
    $id('kscap-pcommentProgress').textContent = commentDone + '/' + commentTotal;
    $id('kscap-bar').style.width = (commentTotal > 0 ? (commentDone / commentTotal) * 100 : 0) + '%';
  }

  function onComplete(data) {
    $id('kscap-pstatus').textContent = '已完成';
    $id('kscap-pstatus').style.color = '#4caf50';
    $id('kscap-bar').style.background = '#4caf50';
    $id('kscap-bar').style.width = '100%';
    progressEl.style.display = 'block';
    setStatus(
      '所有任务已完成！关键词 ' + data.totalKeywords + ' 个 · 视频 ' + data.totalVideos + ' 个 · 评论 ' + data.totalComments + ' 条',
      'success',
    );
  }

  function restoreProgress() {
    if (store.get('taskRunning', false)) {
      onTaskStarted();
      updateProgress(store.get('taskProgress') || {});
    }
  }

  return { setStatus, updateProgress, onTaskStarted, onComplete, build, appendLog };
})();

/*
 * 快手AI自动获客助手 —— 开源模块：赞赏支持
 * 本文件属于项目的开源部分，基于 MIT 协议发布。
 * 在面板按钮行添加「赞赏」按钮，点击弹出赞赏码。
 * 赞赏码图片（DONATE_IMG）由 build.js 在构建时注入。
 */

(function () {
  'use strict';

  const PROMO_LINKS = [['www.xygy.top', 'https://www.xygy.top'], ['vnoteai.cn', 'https://www.vnoteai.cn/']];
  const DONATE_IMG = 'data:image/png;base64,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';

  function openDonate() {
    let mask = document.getElementById('kscap-donate-mask');
    if (mask) {
      mask.style.display = 'flex';
      return;
    }
    mask = document.createElement('div');
    mask.id = 'kscap-donate-mask';
    mask.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;' +
      'display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText =
      'background:#fff;border-radius:12px;padding:18px 16px 14px;text-align:center;' +
      'max-width:320px;font-family:system-ui,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.3);';
    const title = document.createElement('div');
    title.textContent = '请作者喝一杯 ☕';
    title.style.cssText = 'font-weight:700;font-size:15px;color:#333;margin-bottom:4px;';
    const sub = document.createElement('div');
    sub.textContent = '微信扫码赞赏，金额随意，感谢每一份支持';
    sub.style.cssText = 'font-size:12px;color:#888;margin-bottom:12px;';
    const img = document.createElement('img');
    img.src = DONATE_IMG;
    img.alt = '赞赏码';
    img.style.cssText = 'width:260px;height:auto;border-radius:8px;display:block;margin:0 auto;';
    const tip = document.createElement('div');
    tip.textContent = '赞赏后如有功能建议，欢迎到项目主页提 Issue';
    tip.style.cssText = 'font-size:11px;color:#aaa;margin-top:10px;';
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText =
      'margin-top:10px;padding:6px 28px;border:none;border-radius:6px;' +
      'background:#9e9e9e;color:#fff;cursor:pointer;font-size:12px;';
    close.addEventListener('click', () => (mask.style.display = 'none'));
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(img);
    card.appendChild(tip);
    const partners = document.createElement('div');
    partners.style.cssText = 'font-size:11px;margin-top:8px;color:#666;';
    partners.append('合作站点：');
    PROMO_LINKS.forEach(([text, url], i) => {
      if (i > 0) partners.append(' · ');
      const a = document.createElement('a');
      a.textContent = text;
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.cssText = 'color:#2196f3;text-decoration:none;';
      partners.appendChild(a);
    });
    card.appendChild(partners);
    card.appendChild(close);
    mask.appendChild(card);
    mask.addEventListener('click', (e) => {
      if (e.target === mask) mask.style.display = 'none';
    });
    document.body.appendChild(mask);
  }

  function inject() {
    const root = document.getElementById('kscap-root');
    if (!root || root.querySelector('#kscap-donate-btn')) return Boolean(root.querySelector('#kscap-donate-btn'));
    const btns = root.querySelector('.kscap-btns');
    if (!btns) return false;
    const btn = document.createElement('button');
    btn.id = 'kscap-donate-btn';
    btn.textContent = '👍 赞赏';
    btn.title = '请作者喝一杯';
    btn.style.cssText =
      'flex:0 0 72px;background:#ff9800;color:#fff;border:none;border-radius:4px;' +
      'padding:6px 0;cursor:pointer;font-size:12px;';
    btn.addEventListener('click', openDonate);
    btns.appendChild(btn);
    injectPromoLinks(root);
    enhanceStartButton(root);
    return true;
  }

  function enhanceStartButton(root) {
    const start = root.querySelector('#kscap-start');
    const status = root.querySelector('#kscap-status');
    if (!start || !status || start.dataset.promoHooked) return;
    start.dataset.promoHooked = '1';
    start.addEventListener('click', () => {
      setTimeout(() => {
        if (status.textContent.includes('任务已开始')) {
          const span = document.createElement('span');
          span.append(' · 推荐：');
          PROMO_LINKS.forEach(([text, url], i) => {
            if (i > 0) span.append(' · ');
            const a = document.createElement('a');
            a.textContent = text;
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'color:#2196f3;text-decoration:none;';
            span.appendChild(a);
          });
          status.appendChild(span);
        }
      }, 0);
    });
  }

  function injectPromoLinks(root) {
    if (root.querySelector('.kscap-promo')) return;
    const footer = document.createElement('div');
    footer.className = 'kscap-promo';
    footer.style.cssText = 'color:#999;font-size:11px;margin-top:4px;';
    footer.append('推荐：');
    PROMO_LINKS.forEach(([text, url], i) => {
      if (i > 0) footer.append(' · ');
      const a = document.createElement('a');
      a.textContent = text;
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.cssText = 'color:#2196f3;text-decoration:none;';
      footer.appendChild(a);
    });
    root.appendChild(footer);
  }

  const timer = setInterval(() => {
    if (inject()) clearInterval(timer);
  }, 400);
  setTimeout(() => clearInterval(timer), 15000);
})();

/*
 * 快手AI自动获客助手 —— 开源模块：启动引导（MIT License）
 */

function main() {
  if (window.top !== window.self) return;
  if (document.getElementById('kscap-root')) return;
  panel.build();
  // 全局异常捕获：任何未捕获错误都进面板日志，避免一闪而过
  window.addEventListener('error', (e) => {
    console.error('[快手AI自动获客助手] 未捕获错误:', e.message, e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[快手AI自动获客助手] 未处理的Promise拒绝:', (e.reason && (e.reason.stack || e.reason.message)) || e.reason);
  });
  console.log('[快手AI自动获客助手] 已加载（开源版，无需授权）', location.href);
  bootResume();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

})();
