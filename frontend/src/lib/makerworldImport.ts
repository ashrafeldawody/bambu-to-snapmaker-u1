export interface MakerWorldRequest {
  url: string;
  name: string;
  pageUrl: string | null;
}

export function readMakerWorldRequest(): MakerWorldRequest | null {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('src');
  if (!url) return null;
  return {
    url,
    name: ensure3mfName(params.get('name') || 'makerworld-model.3mf'),
    pageUrl: params.get('page'),
  };
}

export function clearMakerWorldRequest() {
  const clean = window.location.pathname + window.location.hash;
  window.history.replaceState(null, '', clean);
}

function ensure3mfName(name: string): string {
  const safe = name.replace(/[\\/:\x00]/g, '_').trim() || 'makerworld-model';
  return safe.toLowerCase().endsWith('.3mf') ? safe : `${safe}.3mf`;
}

export class HostPermissionNeeded extends Error {
  constructor(public origin: string) {
    super(`The extension needs permission to download from ${new URL(origin).host}`);
  }
}

interface ChromePermissions {
  contains(p: { origins: string[] }): Promise<boolean>;
  request(p: { origins: string[] }): Promise<boolean>;
}

function chromePermissions(): ChromePermissions | null {
  const api = (globalThis as { chrome?: { permissions?: ChromePermissions } }).chrome;
  return api?.permissions ?? null;
}

function originPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

export async function requestHostPermission(origin: string): Promise<boolean> {
  const permissions = chromePermissions();
  if (!permissions) return false;
  return permissions.request({ origins: [`${origin}/*`] });
}

async function fetchWithPermissionCheck(url: string): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'omit' });
  } catch (err) {
    const permissions = chromePermissions();
    if (permissions && !(await permissions.contains({ origins: [originPattern(url)] }))) {
      throw new HostPermissionNeeded(new URL(url).origin);
    }
    throw err;
  }
}

export async function downloadMakerWorldFile(
  request: MakerWorldRequest,
  onProgress: (received: number, total: number | null) => void,
): Promise<File> {
  const response = await fetchWithPermissionCheck(request.url);
  if (!response.ok) throw new Error(`MakerWorld returned ${response.status} for the 3MF download`);
  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;
  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, blob.size);
    return new File([blob], request.name, { type: 'application/octet-stream' });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  return new File(chunks as BlobPart[], request.name, { type: 'application/octet-stream' });
}
