const CONVERTER_PAGE = 'app/extension.html';
const OFFSCREEN_PAGE = 'offscreen/offscreen.html';

let offscreenReady = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PAGE)],
  });
  if (contexts.length > 0) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: OFFSCREEN_PAGE,
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Runs the 3MF converter engine and hands the converted file to the downloads API.',
    }).finally(() => { offscreenReady = null; });
  }
  await offscreenReady;
}

async function toOffscreen(message) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

function openConverter(params) {
  const url = new URL(chrome.runtime.getURL(CONVERTER_PAGE));
  for (const [key, value] of Object.entries(params || {})) {
    if (value) url.searchParams.set(key, value);
  }
  return chrome.tabs.create({ url: url.href });
}

async function convertAndDownload(message, tabId) {
  const result = await toOffscreen({ type: 'convert', url: message.src, name: message.name, tabId });
  if (!result?.ok) return result || { ok: false, error: 'The converter did not answer' };
  await chrome.downloads.download({ url: result.blobUrl, filename: result.filename, conflictAction: 'uniquify' });
  return { ok: true, filename: result.filename, profile: result.profile, warnings: result.warnings };
}

chrome.action.onClicked.addListener(() => {
  openConverter();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false;

  if (message?.type === 'u1-progress') {
    if (message.tabId) chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
    return false;
  }

  if (message?.type === 'warm-engine') {
    toOffscreen({ type: 'warm' }).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'convert-and-download') {
    convertAndDownload(message, sender.tab?.id)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === 'open-converter') {
    openConverter({ src: message.src, name: message.name, page: message.page || sender.tab?.url })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});
