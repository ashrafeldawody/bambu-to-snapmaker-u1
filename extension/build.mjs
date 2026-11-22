import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const dist = join(here, 'dist');
const cacheDir = join(here, '.wheel-cache');
const pyodideModule = join(here, 'node_modules', 'pyodide');
const wantedPackages = ['pydantic', 'pyyaml'];
const pyodideRuntimeFiles = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const backendExcluded = new Set(['main.py', 'telemetry.py', 'security.py']);
const args = new Set(process.argv.slice(2));

function step(message) {
  console.log(`\n> ${message}`);
}

function normaliseName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function resolvePackageClosure(lock, names) {
  const byName = new Map(Object.entries(lock.packages).map(([key, pkg]) => [normaliseName(key), pkg]));
  const resolved = new Map();
  const pending = [...names];
  while (pending.length) {
    const name = normaliseName(pending.pop());
    if (resolved.has(name)) continue;
    const pkg = byName.get(name);
    if (!pkg) throw new Error(`Package ${name} is not in the Pyodide lockfile`);
    resolved.set(name, pkg);
    pending.push(...(pkg.depends || []));
  }
  return [...resolved.values()];
}

async function fetchWheel(pyodideVersion, pkg) {
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, pkg.file_name);
  if (existsSync(cached) && sha256(readFileSync(cached)) === pkg.sha256) return readFileSync(cached);
  const url = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/${pkg.file_name}`;
  console.log(`  downloading ${pkg.file_name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== pkg.sha256) throw new Error(`Checksum mismatch for ${pkg.file_name}`);
  writeFileSync(cached, bytes);
  return bytes;
}

async function bundlePyodide() {
  step('Bundling the Pyodide runtime');
  const target = join(dist, 'pyodide');
  mkdirSync(target, { recursive: true });
  for (const file of pyodideRuntimeFiles) cpSync(join(pyodideModule, file), join(target, file));
  const lock = JSON.parse(readFileSync(join(pyodideModule, 'pyodide-lock.json'), 'utf8'));
  const version = JSON.parse(readFileSync(join(pyodideModule, 'package.json'), 'utf8')).version;
  for (const pkg of resolvePackageClosure(lock, wantedPackages)) {
    writeFileSync(join(target, pkg.file_name), await fetchWheel(version, pkg));
  }
}

function listFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function bundlePython() {
  step('Bundling the converter sources, reference profiles and rules');
  const target = join(dist, 'py');
  mkdirSync(join(target, 'backend'), { recursive: true });
  for (const file of readdirSync(join(repo, 'backend'))) {
    if (file.endsWith('.py') && !backendExcluded.has(file)) cpSync(join(repo, 'backend', file), join(target, 'backend', file));
  }
  cpSync(join(here, 'python'), join(target, 'backend'), { recursive: true });
  cpSync(join(repo, 'profiles'), join(target, 'profiles'), { recursive: true, filter: (p) => !p.endsWith('.gitkeep') });
  cpSync(join(repo, 'rules'), join(target, 'rules'), { recursive: true });
  const listing = listFiles(target).map((file) => relative(target, file).split('\\').join('/')).sort();
  writeFileSync(join(target, 'files.json'), JSON.stringify(listing, null, 2));
}

function buildFrontend() {
  step('Building the converter UI');
  const frontend = join(repo, 'frontend');
  if (!existsSync(join(frontend, 'node_modules'))) execSync('npm install', { cwd: frontend, stdio: 'inherit' });
  execSync('npx vite build --mode extension', { cwd: frontend, stdio: 'inherit' });
}

function copyStatic() {
  step('Copying the extension shell');
  cpSync(join(here, 'static'), dist, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  manifest.version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function zipDist() {
  step('Packing the extension zip');
  const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
  const zipPath = join(here, `u1-converter-extension-${version}.zip`);
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${dist}\\*' -DestinationPath '${zipPath}'"`, { stdio: 'inherit' });
  } else {
    execSync(`cd "${dist}" && zip -qr "${zipPath}" .`, { stdio: 'inherit' });
  }
  console.log(`  ${zipPath}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await bundlePyodide();
bundlePython();
if (!args.has('--skip-ui')) buildFrontend();
copyStatic();
if (args.has('--zip')) zipDist();
console.log(`\nDone. Load ${dist} as an unpacked extension.`);
