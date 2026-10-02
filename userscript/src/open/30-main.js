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
