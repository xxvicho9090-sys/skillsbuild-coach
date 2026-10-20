// Modo local integrado: sirve la app y conecta con tu Ollama sin configurar nada.
//   node scripts/local.mjs [--port 5173] [--lan] [--no-open] [--no-update]
// - Sirve public/ en http://localhost:5173 (instalable como PWA).
// - /ollama/*  →  Ollama (127.0.0.1:11434) por el mismo origen: no hace falta OLLAMA_ORIGINS.
// - Arranca Ollama si no está corriendo y trae las novedades del repo (git pull) si existe .git.
// - Por defecto solo escucha en este equipo; --lan lo abre a tu Wi-Fi (para usarlo desde el celular).
import { createServer, request, get } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const port = Number(args[args.indexOf('--port') + 1]) || 5173;
const OLLAMA = { host: '127.0.0.1', port: 11434 };
const repo = fileURLToPath(new URL('..', import.meta.url));
const root = join(repo, 'public') + (process.platform === 'win32' ? '\\' : '/');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.traineddata': 'application/octet-stream' };
const log = (m) => console.log(`[${new Date().toLocaleTimeString('es')}] ${m}`);

const lanIPs = () => Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const okHost = (host = '') => {
  const h = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || (flag('lan') && lanIPs().includes(h));
};

function ollamaUp() {
  return new Promise((ok) => {
    const r = get({ ...OLLAMA, path: '/api/version', timeout: 1500 }, (res) => { res.resume(); ok(res.statusCode === 200); });
    r.on('error', () => ok(false));
    r.on('timeout', () => { r.destroy(); ok(false); });
  });
}

async function ensureOllama() {
  if (await ollamaUp()) return log('Ollama ya está activo.');
  log('Iniciando Ollama…');
  try { spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* sin ollama en PATH */ }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await ollamaUp()) return log('Ollama listo.');
  }
  log('No pude iniciar Ollama: ábrelo manualmente (la app te avisará).');
}

function update() {
  if (flag('no-update') || !existsSync(join(repo, '.git'))) return Promise.resolve();
  return new Promise((ok) => execFile('git', ['pull', '--ff-only', '--quiet'], { cwd: repo, timeout: 20000, windowsHide: true }, (e) => { log(e ? 'Sin conexión para actualizar (se usa la versión local).' : 'App al día con GitHub.'); ok(); }));
}

function proxy(req, res) {
  const headers = { ...req.headers, host: `${OLLAMA.host}:${OLLAMA.port}` };
  delete headers.origin; delete headers.referer; delete headers['x-forwarded-for'];
  const up = request({ ...OLLAMA, path: req.url.replace(/^\/ollama/, '') || '/', method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, 'x-sbc-local': '1' });
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json', 'x-sbc-local': '1' }); res.end(JSON.stringify({ error: 'Ollama no responde' })); });
  res.on('close', () => up.destroy());
  req.pipe(up);
}

const server = createServer(async (req, res) => {
  // Señal de vida para la web publicada: solo dice que la versión local está corriendo (sin datos).
  if (okHost(req.headers.host) && req.url === '/__sbc') {
    // Chrome pide permiso de "red privada" (preflight) cuando una web pública llama a localhost.
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '600' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ app: 'skillsbuild-coach' }));
    return;
  }
  // Anti-CSRF y anti-DNS-rebinding: solo este mismo sitio puede usar el puente a Ollama.
  const origin = req.headers.origin;
  const sameOrigin = !origin || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
  if (!okHost(req.headers.host) || !sameOrigin) { res.writeHead(403).end('Prohibido'); return; }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/ollama' || path.startsWith('/ollama/')) return proxy(req, res);
  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let data;
  try { data = await readFile(file); } catch { res.writeHead(404).end('No encontrado'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
});

function openBrowser(url) {
  if (flag('no-open')) return;
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* abre la URL a mano */ }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { log(`Ya hay una copia corriendo en el puerto ${port}: la abro.`); openBrowser(`http://localhost:${port}`); setTimeout(() => process.exit(0), 500); }
  else { console.error(e); process.exit(1); }
});

await update();
await ensureOllama();
server.listen(port, flag('lan') ? '0.0.0.0' : '127.0.0.1', () => {
  log(`SkillsBuild Coach: http://localhost:${port}`);
  if (flag('lan')) lanIPs().forEach((ip) => log(`  Desde el celular (misma Wi-Fi): http://${ip}:${port}`));
  openBrowser(`http://localhost:${port}`);
});
