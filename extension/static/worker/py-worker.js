import { loadPyodide } from '../pyodide/pyodide.mjs';

const APP_ROOT = '/app';
const PACKAGES = ['pydantic', 'pyyaml'];

let enginePromise = null;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

async function writeBundledFiles(pyodide, baseUrl) {
  const listing = await fetchJson(new URL('files.json', baseUrl));
  await Promise.all(listing.map(async (relativePath) => {
    const response = await fetch(new URL(relativePath.split('/').map(encodeURIComponent).join('/'), baseUrl));
    if (!response.ok) throw new Error(`Could not load ${relativePath}: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const target = `${APP_ROOT}/${relativePath}`;
    pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
    pyodide.FS.writeFile(target, bytes);
  }));
}

async function startEngine() {
  const pyodideUrl = new URL('../pyodide/', import.meta.url).href;
  const bundleUrl = new URL('../py/', import.meta.url).href;
  const pyodide = await loadPyodide({ indexURL: pyodideUrl, packageBaseUrl: pyodideUrl });
  await pyodide.loadPackage(PACKAGES, { messageCallback: () => {}, errorCallback: (m) => console.warn(m) });
  await writeBundledFiles(pyodide, bundleUrl);
  for (const dir of ['user_profiles', 'bambu_profiles', 'work', 'in']) {
    pyodide.FS.mkdirTree(`${APP_ROOT}/${dir}`);
  }
  pyodide.runPython(`
import os, sys
os.environ["U13MF_APP_ROOT"] = "${APP_ROOT}"
sys.path.insert(0, "${APP_ROOT}/backend")
import local_api
`);
  return pyodide;
}

function engine() {
  if (!enginePromise) enginePromise = startEngine();
  return enginePromise;
}

function safeName(name) {
  return String(name || 'upload.3mf').replace(/[\\/:\x00]/g, '_');
}

async function call(method, args, fileBuffer, fileName) {
  const pyodide = await engine();
  const payload = { ...(args || {}) };
  if (fileBuffer) {
    const inputPath = `${APP_ROOT}/in/${crypto.randomUUID()}`;
    pyodide.FS.writeFile(inputPath, new Uint8Array(fileBuffer));
    payload.input_path = inputPath;
    payload.filename = safeName(fileName);
  }
  const dispatch = pyodide.globals.get('local_api').dispatch;
  const reply = JSON.parse(dispatch(method, JSON.stringify(payload)));
  if (payload.input_path) {
    try { pyodide.FS.unlink(payload.input_path); } catch { }
  }
  let output = null;
  if (reply.ok && reply.body && typeof reply.body === 'object' && reply.body.output_path) {
    output = pyodide.FS.readFile(reply.body.output_path);
    pyodide.FS.unlink(reply.body.output_path);
    delete reply.body.output_path;
  }
  return { reply, output };
}

self.onmessage = async (event) => {
  const { id, method, args, file, fileName } = event.data;
  try {
    const { reply, output } = await call(method, args, file, fileName);
    if (output) {
      self.postMessage({ id, reply, output: output.buffer }, [output.buffer]);
    } else {
      self.postMessage({ id, reply });
    }
  } catch (err) {
    self.postMessage({ id, reply: { ok: false, status: 500, detail: err?.message || String(err) } });
  }
};

engine().then(
  () => self.postMessage({ type: 'ready' }),
  (err) => self.postMessage({ type: 'failed', detail: err?.message || String(err) }),
);
