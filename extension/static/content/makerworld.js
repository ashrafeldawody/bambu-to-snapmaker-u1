(() => {
  const ITEM_ATTR = 'data-u1c-item';
  const MODEL_PATH = /\/models\/(\d+)/;
  const PROFILE_HASH = /profileId-(\d+)/;
  const MENU_HINT = /3MF|STL|Bambu Studio/i;
  const LABEL = 'Download for Snapmaker U1';
  const API_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    'x-bbl-client-type': 'web',
    'x-bbl-client-name': 'MakerWorld',
    'x-bbl-app-source': 'makerworld',
    'x-bbl-client-version': '00.00.00.01',
  };

  let busy = false;
  let warmed = false;

  function modelId() {
    const match = location.pathname.match(MODEL_PATH);
    return match ? match[1] : null;
  }

  async function api(path) {
    const response = await fetch(path, { credentials: 'include', headers: API_HEADERS });
    if (response.status === 401) throw new Error('Log in to MakerWorld to download this model.');
    if (response.status === 403 || response.status === 418) {
      throw new Error('MakerWorld wants a verification. Use Download 3MF once, then try again.');
    }
    if (!response.ok) throw new Error(`MakerWorld returned ${response.status}.`);
    return response.json();
  }

  async function resolveInstance(id) {
    const fromHash = (location.hash.match(PROFILE_HASH) || location.search.match(PROFILE_HASH) || [])[1];
    const design = await api(`/api/v1/design-service/design/${id}`);
    const instances = Array.isArray(design?.instances) ? design.instances : [];
    const chosen = (fromHash && instances.find((i) => String(i.id) === fromHash))
      || (fromHash && instances.find((i) => String(i.profileId) === fromHash))
      || instances.find((i) => i.id === design?.defaultInstanceId)
      || instances.find((i) => i.isDefault)
      || instances[0];
    if (!chosen && fromHash) return { id: fromHash, title: '', designTitle: design?.title || '' };
    if (!chosen) throw new Error('This model has no downloadable print profile.');
    return { id: chosen.id, title: chosen.title || '', designTitle: design?.title || '' };
  }

  async function requestFile(instance) {
    const payload = await api(`/api/v1/design-service/instance/${instance.id}/f3mf?type=download&fileType=`);
    if (!payload?.url) throw new Error(payload?.message || 'MakerWorld did not return a download link.');
    const fallback = `${instance.designTitle || 'makerworld-model'}.3mf`;
    return { url: payload.url, name: payload.name || fallback };
  }

  const toast = (() => {
    let node = null;
    let hideTimer = null;

    function ensure() {
      if (node && document.body.contains(node)) return node;
      node = document.createElement('div');
      node.className = 'u1c-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.innerHTML = '<span class="u1c-toast-icon"></span><div class="u1c-toast-body"><div class="u1c-toast-title"></div><div class="u1c-toast-text"></div></div><button type="button" class="u1c-toast-close" aria-label="Close">×</button>';
      node.querySelector('.u1c-toast-close').addEventListener('click', () => hide());
      document.body.append(node);
      return node;
    }

    function show(kind, title, text = '', autoHideMs = 0) {
      const el = ensure();
      clearTimeout(hideTimer);
      el.dataset.kind = kind;
      el.querySelector('.u1c-toast-title').textContent = title;
      const body = el.querySelector('.u1c-toast-text');
      body.textContent = '';
      for (const line of [].concat(text).filter(Boolean)) {
        const row = document.createElement('div');
        row.textContent = line;
        body.append(row);
      }
      requestAnimationFrame(() => el.classList.add('u1c-show'));
      if (autoHideMs) hideTimer = setTimeout(hide, autoHideMs);
    }

    function hide() {
      if (node) node.classList.remove('u1c-show');
    }

    return { show };
  })();

  function closeMenu() {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.click();
  }

  const CHUNK_BYTES = 4 * 1024 * 1024;

  function decodeBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function fetchConvertedBytes(jobId, size) {
    const parts = [];
    for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
      const reply = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'chunk', jobId, offset, length: CHUNK_BYTES });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not read the converted file.');
      parts.push(decodeBase64(reply.data));
    }
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'release', jobId }).catch(() => {});
    return parts;
  }

  async function saveConvertedFile(result) {
    const parts = await fetchConvertedBytes(result.jobId, result.size);
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function run() {
    const id = modelId();
    if (!id || busy) return;
    busy = true;
    setButtonState('busy', 'Fetching print profile…');
    try {
      const instance = await resolveInstance(id);
      const file = await requestFile(instance);
      setButtonState('busy', 'Downloading…');
      const result = await chrome.runtime.sendMessage({ type: 'convert-and-download', src: file.url, name: file.name });
      if (!result?.ok) throw new Error(result?.error || 'The conversion failed.');
      setButtonState('busy', 'Saving…');
      await saveConvertedFile(result);
      const lines = [`${result.filename} · ${result.profile} profile`, ...result.warnings];
      toast.show('done', 'Downloaded for Snapmaker U1', lines, result.warnings.length ? 12000 : 6000);
    } catch (err) {
      toast.show('error', 'Could not prepare the U1 file', err?.message || String(err), 10000);
    } finally {
      busy = false;
      setButtonState('idle', LABEL);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'u1-progress' || !busy) return;
    const downloading = message.stage.startsWith('Downloading');
    setButtonState('busy', downloading ? `${message.stage}…` : 'Converting for U1…');
  });

  function warmEngine() {
    if (warmed) return;
    warmed = true;
    chrome.runtime.sendMessage({ type: 'warm-engine' }).catch(() => { warmed = false; });
  }

  function menuItems(menu) {
    return [...menu.querySelectorAll('*')].filter((el) => {
      if (el.hasAttribute(ITEM_ATTR) || el.closest(`[${ITEM_ATTR}]`)) return false;
      const text = el.textContent.trim();
      return text.length < 40 && MENU_HINT.test(text);
    });
  }

  function sharedItemClass(candidates) {
    const counts = new Map();
    for (const el of candidates) {
      for (const cls of el.classList) {
        if (cls.startsWith('u1c')) continue;
        counts.set(cls, (counts.get(cls) || 0) + 1);
      }
    }
    let best = null;
    for (const [cls, count] of counts) {
      if (count >= 2 && (!best || count > best[1])) best = [cls, count];
    }
    return best ? best[0] : null;
  }

  function enhanceMenu(menu) {
    if (!modelId() || menu.querySelector(`[${ITEM_ATTR}]`)) return;
    const candidates = menuItems(menu);
    const itemClass = sharedItemClass(candidates);
    if (!itemClass) return;
    const siblings = candidates.filter((el) => el.classList.contains(itemClass));
    const template = siblings.find((el) => el.children.length === 0) || siblings[0];
    const anchor = siblings[siblings.length - 1];
    const item = document.createElement(template.tagName);
    item.className = itemClass;
    item.setAttribute(ITEM_ATTR, '');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.textContent = LABEL;
    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setTimeout(closeMenu, 0);
      run();
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    anchor.after(item);
    warmEngine();
  }

  const BUTTON_ATTR = 'data-u1c-button';
  const DOWNLOAD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function buttonStack(primary) {
    let node = primary;
    for (let i = 0; i < 7 && node; i++) {
      node = node.parentElement;
      if (node && getComputedStyle(node).flexDirection === 'column') return node;
    }
    return null;
  }

  function setButtonState(state, text) {
    for (const button of document.querySelectorAll(`[${BUTTON_ATTR}]`)) {
      button.dataset.state = state;
      button.disabled = state === 'busy';
      button.querySelector('.u1c-btn-label').textContent = text;
    }
  }

  function addPageButton() {
    if (!modelId()) return;
    for (const primary of document.querySelectorAll('span.primaryButton')) {
      const split = primary.parentElement;
      if (!split || !split.querySelector('.icon-box')) continue;
      const stack = buttonStack(primary);
      if (!stack || stack.querySelector(`[${BUTTON_ATTR}]`)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'u1c-btn';
      button.setAttribute(BUTTON_ATTR, '');
      button.dataset.state = busy ? 'busy' : 'idle';
      button.disabled = busy;
      button.innerHTML = `<span class="u1c-btn-icon">${DOWNLOAD_ICON}</span><span class="u1c-btn-label">${busy ? 'Preparing…' : LABEL}</span>`;
      button.addEventListener('click', () => run());
      button.addEventListener('mouseenter', warmEngine, { once: true });
      stack.append(button);
    }
  }

  function scan() {
    addPageButton();
    for (const menu of document.querySelectorAll('[role="tooltip"], [role="menu"]')) {
      if (MENU_HINT.test(menu.textContent || '')) enhanceMenu(menu);
    }
  }

  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
