(() => {
  const ROOT_ID = 'u1c-root';
  const MODEL_PATH = /\/models\/(\d+)/;
  const PROFILE_HASH = /profileId-(\d+)/;
  let renderedFor = '';
  let designCache = new Map();

  function currentModelId() {
    const match = location.pathname.match(MODEL_PATH);
    return match ? match[1] : null;
  }

  function currentProfileId() {
    const match = location.hash.match(PROFILE_HASH) || location.search.match(PROFILE_HASH);
    return match ? match[1] : null;
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
    }
    return null;
  }

  function apiHeaders() {
    const headers = { Accept: 'application/json' };
    const token = readCookie('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function designFromNextData(modelId) {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script) return null;
    try {
      const design = JSON.parse(script.textContent)?.props?.pageProps?.design;
      return design && String(design.id) === modelId ? design : null;
    } catch {
      return null;
    }
  }

  function unwrapDesign(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (Array.isArray(payload.instances)) return payload;
    for (const key of ['design', 'data', 'result']) {
      if (payload[key] && Array.isArray(payload[key].instances)) return payload[key];
    }
    return null;
  }

  async function loadDesign(modelId) {
    if (designCache.has(modelId)) return designCache.get(modelId);
    let design = designFromNextData(modelId);
    if (!design) {
      const response = await fetch(`/api/v1/design-service/design/${modelId}`, {
        credentials: 'include',
        headers: apiHeaders(),
      });
      if (!response.ok) throw new Error(`MakerWorld returned ${response.status} while reading the model`);
      design = unwrapDesign(await response.json());
    }
    if (!design || !Array.isArray(design.instances) || design.instances.length === 0) {
      throw new Error('No downloadable print profiles were found for this model');
    }
    designCache.set(modelId, design);
    return design;
  }

  function pickInstance(design, profileId) {
    const instances = design.instances;
    if (profileId) {
      const hit = instances.find((i) => String(i.profileId) === profileId)
        || instances.find((i) => String(i.id) === profileId);
      if (hit) return hit;
    }
    return instances.find((i) => i.isDefault) || instances[0];
  }

  function fileNameFor(design, instance, suggested) {
    if (suggested && /\.3mf$/i.test(suggested)) return suggested;
    const base = [design.title, instance.title].filter(Boolean).join(' - ') || `makerworld-${instance.id}`;
    return `${base.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 120)}.3mf`;
  }

  async function requestDownload(instance) {
    const response = await fetch(`/api/v1/design-service/instance/${instance.id}/f3mf?type=download`, {
      credentials: 'include',
      headers: apiHeaders(),
    });
    if (response.status === 401) throw new Error('Log in to MakerWorld first, then try again');
    if (response.status === 403 || response.status === 418) {
      throw new Error('MakerWorld blocked the download. Open the normal download dialog once (it may ask for a captcha), then try again');
    }
    if (!response.ok) throw new Error(`MakerWorld returned ${response.status} for the download`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      return { url: response.url, name: null };
    }
    const payload = await response.json();
    const body = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const url = body?.url || body?.downloadUrl || body?.fileUrl;
    if (!url) throw new Error(payload?.message || payload?.error || 'MakerWorld did not return a download link');
    return { url, name: body?.name || body?.fileName || null };
  }

  function element(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
  }

  function setStatus(root, message, kind = 'info') {
    const status = root.querySelector('.u1c-status');
    status.textContent = message || '';
    status.dataset.kind = kind;
    status.hidden = !message;
  }

  async function convertInstance(root, design, instance) {
    const button = root.querySelector('.u1c-main');
    button.disabled = true;
    setStatus(root, `Preparing "${instance.title || 'print profile'}"…`);
    try {
      const { url, name } = await requestDownload(instance);
      const reply = await chrome.runtime.sendMessage({
        type: 'open-converter',
        src: url,
        name: fileNameFor(design, instance, name),
        page: location.href,
      });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not open the converter');
      setStatus(root, 'Opened in the U1 Converter tab.', 'ok');
      closePanel(root);
    } catch (err) {
      setStatus(root, err?.message || String(err), 'error');
    } finally {
      button.disabled = false;
    }
  }

  function closePanel(root) {
    const panel = root.querySelector('.u1c-panel');
    if (panel) panel.remove();
  }

  function showPanel(root, design) {
    closePanel(root);
    const selected = pickInstance(design, currentProfileId());
    const list = element('div', { class: 'u1c-list' });
    for (const instance of design.instances) {
      const meta = [];
      if (instance.isDefault) meta.push('default');
      if (instance === selected) meta.push('selected on page');
      list.append(element('button', {
        class: `u1c-item${instance === selected ? ' u1c-current' : ''}`,
        type: 'button',
        onclick: () => convertInstance(root, design, instance),
      }, [
        element('span', { class: 'u1c-item-title', text: instance.title || `Profile ${instance.id}` }),
        element('span', { class: 'u1c-item-meta', text: meta.join(' · ') }),
      ]));
    }
    const panel = element('div', { class: 'u1c-panel', role: 'dialog', 'aria-label': 'Choose a print profile' }, [
      element('div', { class: 'u1c-panel-head' }, [
        element('span', { text: 'Choose a print profile to convert' }),
        element('button', { class: 'u1c-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => closePanel(root) }),
      ]),
      list,
    ]);
    root.prepend(panel);
  }

  async function onMainClick(root) {
    const modelId = currentModelId();
    if (!modelId) return;
    setStatus(root, 'Reading print profiles…');
    try {
      const design = await loadDesign(modelId);
      setStatus(root, '');
      if (design.instances.length === 1) {
        await convertInstance(root, design, design.instances[0]);
      } else {
        showPanel(root, design);
      }
    } catch (err) {
      setStatus(root, err?.message || String(err), 'error');
    }
  }

  function mount() {
    const root = element('div', { id: ROOT_ID }, [
      element('div', { class: 'u1c-status', hidden: '' }),
    ]);
    const button = element('button', { class: 'u1c-main', type: 'button', title: 'Convert this model for the Snapmaker U1' }, [
      element('span', { class: 'u1c-logo', 'aria-hidden': 'true', text: 'U1' }),
      element('span', { text: 'Convert for Snapmaker U1' }),
    ]);
    button.addEventListener('click', () => onMainClick(root));
    root.append(button);
    document.body.append(root);
    return root;
  }

  function sync() {
    const modelId = currentModelId();
    const existing = document.getElementById(ROOT_ID);
    if (!modelId) {
      if (existing) existing.remove();
      renderedFor = '';
      return;
    }
    if (existing && renderedFor === modelId) return;
    if (existing) existing.remove();
    renderedFor = modelId;
    mount();
  }

  sync();
  setInterval(sync, 1000);
  window.addEventListener('hashchange', () => {
    const root = document.getElementById(ROOT_ID);
    if (root) closePanel(root);
  });
})();
