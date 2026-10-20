// Estado de la app. Vive en IndexedDB de este navegador (aguanta PDFs largos); la copia de seguridad es un JSON.
import { toast } from './dom.js';

const DB = 'sbc', STORE = 'kv', KEY = 'state';
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const dayKey = (d = new Date()) => d.toLocaleDateString('sv-SE');

const defaults = () => ({
  settings: { url: 'http://localhost:11434', model: '', ctx: 4096, theme: 'auto' },
  meta: { seenVersion: '', lastCheck: 0 },
  courses: [],
  cards: [],
  log: {},
  quiz: [],
});

export const S = defaults();

function merge(raw) {
  const d = defaults();
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, d, raw, { settings: { ...d.settings, ...raw?.settings }, meta: { ...d.meta, ...raw?.meta } });
}

function idb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
const tx = (db, mode, fn) => new Promise((ok, fail) => {
  const t = db.transaction(STORE, mode);
  const req = fn(t.objectStore(STORE));
  t.oncomplete = () => ok(req?.result);
  t.onerror = () => fail(t.error);
  t.onabort = () => fail(t.error);
});

let db = null;
export async function init() {
  try {
    db = await idb();
    const saved = await tx(db, 'readonly', (s) => s.get(KEY));
    if (saved) merge(saved);
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    db = null;
    try { const raw = JSON.parse(localStorage.getItem('sbc-fallback') || 'null'); if (raw) merge(raw); } catch { /* vacío */ }
  }
  const flushNow = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', flushNow);
  addEventListener('pagehide', flush);
}

let timer, warned = false;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 350);
}
export async function flush() {
  clearTimeout(timer);
  try {
    if (db) await tx(db, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(S)), KEY));
    else localStorage.setItem('sbc-fallback', JSON.stringify(S));
  } catch {
    if (!warned) { warned = true; toast('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.'); }
  }
}

export function replaceAll(obj) {
  merge(obj);
  return flush();
}

export function logAct(n = 1, key = 'n') {
  const k = dayKey();
  const e = (S.log[k] ||= { n: 0, reviews: 0 });
  e[key] = (e[key] || 0) + n;
  if (key !== 'n') e.n += n;
  save();
}

// Días seguidos con actividad (si hoy aún no hay, cuenta desde ayer para no castigar la mañana).
export function streak() {
  let n = 0;
  const d = new Date();
  if (!(S.log[dayKey(d)]?.n > 0)) d.setDate(d.getDate() - 1);
  while (S.log[dayKey(d)]?.n > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export const findCourse = (id) => S.courses.find((c) => c.id === id);
export const findMod = (cid, mid) => findCourse(cid)?.modules.find((m) => m.id === mid);
export const allModules = () => S.courses.flatMap((c) => c.modules.map((m) => ({ course: c, mod: m })));

export function newModule(title, text = '', source = null) {
  return { id: uid(), title: title || 'Módulo sin título', text, done: false, sheet: null, concepts: [], questions: [], project: '', source, created: Date.now(), processedAt: 0 };
}
export function newCourse(name, deadline = '') {
  return { id: uid(), name: name || 'Curso', deadline, modules: [], created: Date.now() };
}
