import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const sample = process.argv[2];
const outFile = process.argv[3];
if (!sample) {
  console.error('usage: node test/engine-smoke.mjs <source.3mf> [output.3mf]');
  process.exit(2);
}

const { loadPyodide } = await import(pathToFileURL(join(dist, 'pyodide', 'pyodide.mjs')).href);
const pyodideDir = join(dist, 'pyodide') + '/';
const pyodide = await loadPyodide({ indexURL: pyodideDir, packageBaseUrl: pyodideDir });
await pyodide.loadPackage(['pydantic', 'pyyaml'], { messageCallback: () => {} });

const listing = JSON.parse(readFileSync(join(dist, 'py', 'files.json'), 'utf8'));
for (const rel of listing) {
  const target = `/app/${rel}`;
  pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
  pyodide.FS.writeFile(target, readFileSync(join(dist, 'py', rel)));
}
pyodide.runPython('import os, sys\nos.environ["U13MF_APP_ROOT"]="/app"\nsys.path.insert(0,"/app/backend")\nimport local_api');
const dispatch = pyodide.globals.get('local_api').dispatch;

function call(method, args = {}) {
  const reply = JSON.parse(dispatch(method, JSON.stringify(args)));
  if (!reply.ok) throw new Error(`${method} failed: ${reply.status} ${reply.detail}`);
  return reply.body;
}

function stage() {
  pyodide.FS.mkdirTree('/app/in');
  const path = `/app/in/${Math.random().toString(16).slice(2)}`;
  pyodide.FS.writeFile(path, readFileSync(sample));
  return { input_path: path, filename: 'sample.3mf' };
}

const profiles = call('profiles');
console.log(`profiles: ${profiles.length}`);
console.log(`rules: ${call('rules').length}`);
const suggestion = call('suggest-profile', stage());
console.log(`suggested: ${suggestion.display_name} from ${suggestion.source_printer}, ${suggestion.filaments.length} filaments`);
const started = Date.now();
const result = call('convert', { ...stage(), reference_profile: suggestion.profile_id, insert_swap_pauses: 'false' });
const bytes = pyodide.FS.readFile(result.output_path);
console.log(`converted: ${result.download_name}, ${bytes.length} bytes in ${Date.now() - started} ms`);
console.log(`counts: ${JSON.stringify(result.diff.counts)}`);
if (outFile) writeFileSync(outFile, bytes);
