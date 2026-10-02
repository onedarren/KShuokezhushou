/*
 * 构建脚本：把 开源模块 + 核心引擎 组装成用户脚本（全部可读、MIT 开源）
 *
 * 产物：
 *   dist/快手AI自动获客助手.user.js  完整可读版
 *
 * 用法：
 *   node build.js
 */
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DIST = path.join(SRC, '..', 'dist');

const metadata = fs.readFileSync(path.join(SRC, 'header.meta.js'), 'utf8').trim();
const runtime = fs.readFileSync(path.join(SRC, 'open', '01-runtime.js'), 'utf8');
const core = fs.readFileSync(path.join(SRC, 'core', 'core.js'), 'utf8');
const panel = fs.readFileSync(path.join(SRC, 'open', '20-panel.js'), 'utf8');
const main = fs.readFileSync(path.join(SRC, 'open', '30-main.js'), 'utf8');
const donate = fs.readFileSync(path.join(SRC, 'open', '40-donate.js'), 'utf8');

// 赞赏码图片：与抖音版共用同一张，构建时从 DY 项目 40-donate.js 提取注入
function loadDonateImage() {
  const candidates = [
    'E:/智谱项目/DY电脑版获客/userscript/src/open/40-donate.js',
    path.join(SRC, 'donate-image.b64'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.match(/DONATE_IMG\s*=\s*'(data:image\/png;base64,[^']+)'/);
      if (m) {
        console.log('赞赏码图片来源: ' + file);
        return m[1];
      }
    } catch {}
  }
  console.warn('警告: 未找到赞赏码图片，赞赏弹窗将显示占位图');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180"><rect width="100%" height="100%" fill="#f5f5f5"/><text x="50%" y="50%" text-anchor="middle" fill="#999" font-size="14">赞赏码未配置</text></svg>');
}

const output =
  metadata +
  '\n\n' +
  '// 本脚本完全开源（MIT License），由以下模块组装而成：\n' +
  '//   open/01-runtime.js  运行时基础层\n' +
  '//   core/core.js        核心引擎（源自原扩展 1:1 移植，授权逻辑已移除）\n' +
  '//   open/20-panel.js    浮动控制面板\n' +
  '//   open/40-donate.js   赞赏支持\n' +
  '//   open/30-main.js     启动引导\n' +
  '(function () {\n' +
  runtime + '\n' +
  core + '\n' +
  panel + '\n' +
  donate.split('@@DONATE_IMG@@').join(loadDonateImage()) + '\n' +
  main + '\n' +
  '})();\n';

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, '快手AI自动获客助手.user.js'), output, 'utf8');
console.log('构建完成 -> dist/快手AI自动获客助手.user.js (' + Math.round(output.length / 1024) + ' KB)');
