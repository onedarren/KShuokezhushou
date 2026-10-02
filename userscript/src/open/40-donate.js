/*
 * 快手AI自动获客助手 —— 开源模块：赞赏支持
 * 本文件属于项目的开源部分，基于 MIT 协议发布。
 * 在面板按钮行添加「赞赏」按钮，点击弹出赞赏码。
 * 赞赏码图片（DONATE_IMG）由 build.js 在构建时注入。
 */

(function () {
  'use strict';

  const PROMO_LINKS = [['www.xygy.top', 'https://www.xygy.top'], ['vnoteai.cn', 'https://www.vnoteai.cn/']];
  const DONATE_IMG = '@@DONATE_IMG@@';

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
