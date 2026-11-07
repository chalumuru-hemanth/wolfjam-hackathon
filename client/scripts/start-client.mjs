import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const findVite = () => join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const url = 'http://localhost:5173/';

async function runningGame() {
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(1000) }); }
  catch { return false; }
  if (response.ok && (await response.text()).includes('Wolfjam Arena')) return true;
  throw new Error('Port 5173 is serving another application. Close that server before starting Wolfjam Arena.');
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
  if (await runningGame()) { console.log('The game server is already running.'); openGame(); return; }
  let vite;
  try { vite = findVite(); }
  catch {
    let workspace = false;
    try { workspace = Boolean(JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).workspaces); } catch { /* Standalone client. */ }
    console.log('Installing the locked project dependencies…');
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [workspace ? 'install' : 'ci'], {
      cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('Dependency installation failed. See the npm output above.');
    vite = findVite();
  }
  const server = spawn(process.execPath, [vite, '--host', '0.0.0.0', '--port', '5173', '--strictPort'], {
    cwd: root, stdio: 'inherit', windowsHide: true,
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
