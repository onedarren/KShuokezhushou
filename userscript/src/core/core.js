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
