import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const findVite = () => join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
let url = 'http://localhost:5173/';

async function runningGame() {
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(1000) }); }
  catch { return false; }
  if (response.ok && /<title>(Nightlight|Wolfjam Arena)<\/title>/.test(await response.text())) return true;
  throw new Error('The game port is serving another application. Close it before starting Nightlight.');
}

function openGame() {
  console.log(`Open the game: ${url}`);
  if (process.argv.includes('--no-open')) return;
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/d', '/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Open ${url} manually in your browser.`));
  child.unref();
}

async function main() {
  let workspace = false;
  try { workspace = Boolean(JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).workspaces) &&
    existsSync(join(workspaceRoot, 'server/src/index.ts')); } catch { /* Static/practice checkout. */ }
  url = workspace ? 'http://localhost:2567/' : 'http://localhost:5173/';
  if (await runningGame()) { console.log('The game server is already running.'); openGame(); return; }
  let vite;
  try { vite = findVite(); if (workspace) require.resolve('tsx'); }
  catch {
    console.log('Installing the locked project dependencies…');
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', workspace ? ['install', '--ignore-scripts'] : ['ci'], {
      cwd: workspace ? workspaceRoot : root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('Dependency installation failed. See the npm output above.');
    vite = findVite();
  }
  if (workspace) {
    console.log('Building Nightlight…');
    const built = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: workspaceRoot, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
    });
    if (built.error || built.status !== 0) throw new Error('The game build failed. See the output above.');
  }
  const args = workspace ? ['--import', 'tsx', 'server/src/index.ts'] : [vite, '--host', '0.0.0.0', '--port', '5173', '--strictPort'];
  const server = spawn(process.execPath, args, {
    cwd: workspace ? workspaceRoot : root, stdio: 'inherit', windowsHide: true,
    env: workspace ? { ...process.env, PORT: '2567', NODE_ENV: process.env.NODE_ENV ?? 'production',
      OPS_TOKEN: process.env.OPS_TOKEN || randomBytes(32).toString('hex') } : process.env,
  });
  const exited = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => resolve(code ?? 0));
  });
  process.once('SIGINT', () => { server.kill('SIGINT'); process.exit(0); });
  let ready = false;
  for (let attempt = 0; attempt < 40 && server.exitCode === null; attempt++) {
    if (await runningGame()) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!ready) { server.kill(); throw new Error('The game server did not start. Check the Vite output above.'); }
  openGame();
  console.log('Keep this window open while playing. Press Ctrl+C to stop the server.');
  process.exitCode = Number(await exited);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
