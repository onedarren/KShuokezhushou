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
