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
