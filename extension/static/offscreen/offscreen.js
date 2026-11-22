const worker = new Worker('/worker/py-worker.js', { type: 'module' });
const pending = new Map();
let nextId = 1;

worker.onmessage = (event) => {
  const data = event.data;
  if (data?.type === 'failed') {
    for (const call of pending.values()) call.reject(new Error(data.detail));
    pending.clear();
    return;
  }
  if (data?.type) return;
  const call = pending.get(data.id);
  if (!call) return;
  pending.delete(data.id);
  call.resolve(data);
};

function invoke(method, args = {}, fileBuffer, fileName) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const copy = fileBuffer ? fileBuffer.slice(0) : undefined;
    worker.postMessage({ id, method, args, file: copy, fileName }, copy ? [copy] : []);
  }).then(({ reply, output }) => {
    if (!reply.ok) throw new Error(reply.detail || `Converter error ${reply.status}`);
    return { body: reply.body, output };
  });
}

function progress(tabId, stage) {
  chrome.runtime.sendMessage({ type: 'u1-progress', tabId, stage }).catch(() => {});
}

async function download(url, tabId) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`MakerWorld returned ${response.status} for the file`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) return response.arrayBuffer();
  const reader = response.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, received);
    received += value.length;
    const pct = Math.floor((received / total) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      progress(tabId, `Downloading ${pct}%`);
    }
  }
  return out.buffer;
}

function outputName(name) {
  const base = String(name || 'makerworld-model.3mf').replace(/\.3mf$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_');
  return `${base}.3mf`;
}

function collectWarnings(suggestion) {
  const warnings = [];
  if (suggestion.is_multiplate) warnings.push('Multi-plate project: check each plate in Snapmaker Orca.');
  if (suggestion.is_oversized) warnings.push('Designed for a bed larger than 270×270 mm: check placement.');
  if (suggestion.is_painted_model && suggestion.filaments.length > 4) {
    warnings.push(`${suggestion.filaments.length} painted colours: assign them to the 4 toolheads in Snapmaker Orca.`);
  }
  if (suggestion.is_colour_mixed) warnings.push('Uses colour mixing, which the U1 does not support natively.');
  return warnings;
}

async function convertFromMakerWorld({ url, name, tabId }) {
  progress(tabId, 'Downloading');
  const source = await download(url, tabId);
  const fileName = outputName(name);
  progress(tabId, 'Converting');
  const { body: suggestion } = await invoke('suggest-profile', {}, source, fileName);
  if (suggestion.already_converted) throw new Error('This file is already set up for the Snapmaker U1.');
  const { body: result, output } = await invoke('convert', {
    reference_profile: suggestion.profile_id,
    apply_rules: true,
    clamp_speeds: true,
    preserve_color_painting: true,
    advanced_overrides: '{}',
    slot_map: {},
    insert_swap_pauses: suggestion.filaments.length > 4 && !suggestion.is_painted_model,
  }, source, fileName);
  const blobUrl = URL.createObjectURL(new Blob([output], { type: 'application/octet-stream' }));
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  return {
    blobUrl,
    filename: result.download_name,
    profile: suggestion.display_name,
    warnings: collectWarnings(suggestion),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  if (message.type === 'warm') {
    invoke('profiles').then(() => sendResponse({ ok: true }), (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'convert') {
    convertFromMakerWorld(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
  return false;
});
