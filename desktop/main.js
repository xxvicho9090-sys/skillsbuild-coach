// SkillsBuild Coach · app de escritorio.
// - Sirve la web desde un protocolo propio (app://sbc): Ollama acepta ese origen por defecto, así que no hay
//   servidor local, ni puertos, ni OLLAMA_ORIGINS que configurar.
// - Detecta Ollama en este PC y lo inicia si está instalado pero apagado.
// - Se actualiza sola: baja los archivos nuevos de la web publicada (files.json) y avisa para recargar.
const { app, BrowserWindow, protocol, shell, ipcMain, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const REMOTE = 'https://skillsbuild-coach.onrender.com';
const ORIGIN = 'app://sbc';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const CSP = [
  "default-src 'self' app: data: blob:",
  "script-src 'self' app: 'wasm-unsafe-eval' blob:",
  "worker-src 'self' app: blob:",
  "style-src 'self' app: 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' app: data: https://fonts.gstatic.com",
  "img-src 'self' app: data: blob:",
  "connect-src 'self' app: blob: data: http://localhost:11434 http://127.0.0.1:11434 " + REMOTE,
].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const userWeb = () => path.join(app.getPath('userData'), 'web');
const bundledWeb = () => path.join(__dirname, 'web');
const roots = () => [userWeb(), bundledWeb()];

/* ───────── servir la web ───────── */

function registerProtocol() {
  protocol.handle('app', async (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    for (const root of roots()) {
      const file = path.normalize(path.join(root, p));
      if (!file.startsWith(root + path.sep)) continue;
      try {
        if (!fs.statSync(file).isFile()) continue;
        const body = await fs.promises.readFile(file);
        return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-cache' } });
      } catch { /* prueba la siguiente carpeta */ }
    }
    return new Response('No encontrado', { status: 404 });
  });
}

/* ───────── Ollama ───────── */

const ollamaUp = () => new Promise((ok) => {
  const r = http.get({ host: '127.0.0.1', port: 11434, path: '/api/version', timeout: 1500 }, (res) => { res.resume(); ok(res.statusCode === 200); });
  r.on('error', () => ok(false));
  r.on('timeout', () => { r.destroy(); ok(false); });
});

function findOllama() {
  const local = process.env.LOCALAPPDATA;
  const candidates = [local && path.join(local, 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

async function ensureOllama() {
  if (await ollamaUp()) return { running: true, installed: true };
  const exe = findOllama();
  if (!exe) return { running: false, installed: false };
  try { spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { return { running: false, installed: true }; }
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await ollamaUp()) return { running: true, installed: true };
  }
  return { running: false, installed: true };
}

/* ───────── actualización de la web ───────── */

const getJSON = (url) => new Promise((ok, fail) => {
  https.get(url, { headers: { 'cache-control': 'no-cache' }, timeout: 15000 }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
    let b = '';
    res.setEncoding('utf8');
    res.on('data', (d) => (b += d));
    res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { fail(e); } });
  }).on('error', fail).on('timeout', function () { this.destroy(new Error('timeout')); });
});
const getBuf = (url) => new Promise((ok, fail) => {
  https.get(url, { timeout: 60000 }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
    const parts = [];
    res.on('data', (d) => parts.push(d));
    res.on('end', () => ok(Buffer.concat(parts)));
  }).on('error', fail).on('timeout', function () { this.destroy(new Error('timeout')); });
});
const readManifest = () => {
  for (const root of roots()) { try { return JSON.parse(fs.readFileSync(path.join(root, 'files.json'), 'utf8')); } catch { /* siguiente */ } }
  return { version: '0.0.0', files: [] };
};
const SAFE = /^[\w.\- /]+$/;

async function updateWeb() {
  try {
    const remote = await getJSON(REMOTE + '/files.json');
    const local = readManifest();
    if (!remote?.version || remote.version === local.version || !Array.isArray(remote.files)) return;
    const have = new Map(local.files.map((f) => [f.path, f.sha1]));
    const stage = path.join(app.getPath('userData'), 'web-stage');
    fs.rmSync(stage, { recursive: true, force: true });
    for (const f of remote.files) {
      if (!SAFE.test(f.path) || f.path.includes('..') || f.path.startsWith('/')) throw new Error('ruta no válida: ' + f.path);
      if (have.get(f.path) === f.sha1) continue;
      const buf = await getBuf(REMOTE + '/' + f.path.split('/').map(encodeURIComponent).join('/'));
      if (crypto.createHash('sha1').update(buf).digest('hex') !== f.sha1) throw new Error('hash distinto: ' + f.path);
      const out = path.join(stage, f.path);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
    }
    fs.writeFileSync(path.join(stage, 'files.json'), JSON.stringify(remote));
    // Todo bajó bien: se aplica de una vez (el manifest va al final).
    const dst = userWeb();
    const move = (dir, rel = '') => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const from = path.join(dir, e.name), to = path.join(dst, rel, e.name);
        if (e.isDirectory()) move(from, path.join(rel, e.name));
        else if (e.name !== 'files.json' || rel) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
      }
    };
    move(stage);
    fs.copyFileSync(path.join(stage, 'files.json'), path.join(dst, 'files.json'));
    fs.rmSync(stage, { recursive: true, force: true });
    win?.webContents.send('web-updated', remote.version);
  } catch (e) { console.log('Sin actualización de la web:', e.message); }
}

/* ───────── ventana ───────── */

const openExternal = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    backgroundColor: '#f4efe4', title: 'SkillsBuild Coach', icon: path.join(__dirname, 'icon.ico'), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); openExternal(url); } });
  win.loadURL(ORIGIN + '/index.html');
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  registerProtocol();
  Menu.setApplicationMenu(null);
  // Respuesta de Ollama legible desde app://sbc aunque el usuario haya cambiado OLLAMA_ORIGINS.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'] }, (d, cb) => {
    const h = { ...d.responseHeaders };
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-allow-origin')) delete h[k];
    h['Access-Control-Allow-Origin'] = [ORIGIN];
    cb({ responseHeaders: h });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ipcMain.handle('ollama:ensure', ensureOllama);
  ipcMain.handle('app:reload', () => { win?.webContents.reloadIgnoringCache(); });
  ipcMain.handle('app:open-external', (_e, url) => openExternal(String(url)));
  createWindow();
  ensureOllama().catch(() => {});
  setTimeout(updateWeb, 4000);
  setInterval(updateWeb, 6 * 3600e3);
});
