const CONVERTER_PAGE = 'app/extension.html';

function openConverter(params) {
  const url = new URL(chrome.runtime.getURL(CONVERTER_PAGE));
  for (const [key, value] of Object.entries(params || {})) {
    if (value) url.searchParams.set(key, value);
  }
  return chrome.tabs.create({ url: url.href });
}

chrome.action.onClicked.addListener(() => {
  openConverter();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'open-converter') return false;
  openConverter({ src: message.src, name: message.name, page: message.page || sender.tab?.url })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});
