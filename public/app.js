// SkillsBuild Coach · pantallas, rutas y actualizaciones.
import { $, h, icon, toast, copy, download } from './lib/dom.js';
import { S, init, save, flush, uid, dayKey, streak, logAct, findCourse, findMod, allModules, newCourse, newModule, replaceAll } from './lib/store.js';
import * as ollama from './lib/ollama.js';
import { outline, coverage, wordCount, cleanText, chunkSections } from './lib/text.js';
import { extractFile, ACCEPT, isImage } from './lib/files.js';
import { recognize, stopOCR } from './lib/ocr.js';
import { processModule, moreQuestions, evaluateFeynman, askTutor, makeProject, addCards, conceptCards, makeBook, bookMarkdown, orderModule, orderCourse } from './lib/ai.js';
import { dueCards, grade, label, removeCards } from './lib/srs.js';
import { openReader, docFromSheet, docFromBook } from './lib/reader.js';

const APP_VERSION = '1.5.0'; // lo mantiene scripts/release.mjs
const app = $('#app');

/* ───────── utilidades de interfaz ───────── */

const go = (hash) => { location.hash = hash; };
const fmtDate = (ts) => new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const bytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');

function openModal(title, body) {
  const m = $('#modal');
  const close = h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: closeModal }, icon('x'));
  m.replaceChildren(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'row between' }, h('h2', null, title), close), body));
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  m.querySelector('input,textarea,select,button.btn')?.focus?.({ preventScroll: true });
}
function closeModal() { const m = $('#modal'); m.dispatchEvent(new Event('close-modal')); m.hidden = true; m.replaceChildren(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

async function withBusy(title, fn) {
  const ctrl = new AbortController();
  const msg = h('div', { class: 'muted small' }, 'Preparando…');
  const bar = h('i');
  const b = $('#busy');
  b.replaceChildren(h('div', { class: 'modal', role: 'alertdialog', 'aria-label': title },
    h('div', { class: 'row' }, h('div', { class: 'spinner' }), h('h2', null, title)),
    msg, h('div', { class: 'bar' }, bar),
    h('button', { class: 'btn', onclick: () => ctrl.abort() }, 'Cancelar')));
  b.hidden = false;
  try { return await fn((m, p) => { msg.textContent = m; bar.style.width = Math.round((p || 0) * 100) + '%'; }, ctrl.signal); }
  finally { b.hidden = true; b.replaceChildren(); }
}

const input = (label, attrs = {}) => { const el = h('input', attrs); return { el, field: h('label', { class: 'field' }, label, el) }; };

function applyTheme() {
  const t = S.settings.theme;
  document.documentElement.dataset.theme = t === 'dark' || t === 'auto' ? t : 'light';
  $('meta[name=theme-color]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0e1116';
}

/* ───────── ayuda de conexión con Ollama ───────── */

// En la web publicada: ¿está corriendo Iniciar-Coach en este PC? Si sí, se ofrece abrir la versión local (que conecta sola con Ollama).
let localApp = false;
async function detectLocalApp() {
  if (ollama.integrated.on || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  try { localApp = (await (await fetch('http://localhost:5173/__sbc', { signal: AbortSignal.timeout(1500) })).json()).app === 'skillsbuild-coach'; }
  catch { localApp = false; }
}
const localCard = () => !localApp || ollama.ready() ? null : h('div', { class: 'card row between', style: 'border-color:var(--accent)' },
  h('div', { class: 'grow' }, h('strong', null, 'Tu versión local está lista'), h('div', { class: 'small muted' }, 'Ábrela para usar la IA sin configurar nada. Tus datos de aquí se pasan con Exportar/Importar.')),
  h('a', { class: 'btn primary', href: 'http://localhost:5173/' }, 'Abrir'));


function ollamaHelp() {
  const origin = location.origin;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const dk = ollama.desktop.on;
  const hosted = !local && !ollama.integrated.on && !dk;
  const model = S.settings.model || 'qwen2.5:3b';
  const kindMsg = {
    down: dk
      ? (ollama.status.installed ? 'Ollama está instalado pero no logré iniciarlo. Ábrelo desde el menú Inicio y vuelve a probar.' : 'No encuentro Ollama en este PC. Instálalo y esta app lo detectará sola.')
      : ollama.integrated.on || local
      ? 'No encuentro Ollama. Ábrelo (icono en la bandeja) o inícialo con "ollama serve".'
      : 'No logro conectar con Ollama desde esta web. Usa la versión local integrada (opción A) o da el permiso (opción B).',
    origin: 'Ollama está activo, pero bloquea esta web. Usa la versión local integrada (opción A) o da el permiso (opción B).',
    model: `Falta el modelo "${model}". Instálalo con el comando de abajo.`,
    http: ollama.status.error,
  }[ollama.status.kind];
  const code = (t, c) => h('div', { class: 'stack', style: 'gap:8px' },
    h('div', { class: 'small muted' }, t),
    h('div', { class: 'row' }, h('code', { class: 'codebox grow' }, c), h('button', { class: 'btn small', onclick: () => copy(c) }, 'Copiar')));
  const retry = h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; await ollama.refresh(); e.target.disabled = false; ollama.ready() ? (closeModal(), toast('Conectado a Ollama'), render()) : toast(ollama.status.error || 'Aún sin conexión'); } }, 'Probar conexión');
  return h('div', { class: 'stack' },
    kindMsg && h('div', { class: 'callout' }, kindMsg),
    dk && !ollama.status.installed && h('div', { class: 'card stack', style: 'gap:10px' },
      h('strong', null, 'Instala Ollama (una sola vez)'),
      h('p', { class: 'small muted' }, 'Descárgalo, instálalo y vuelve aquí: la app lo detecta y lo inicia sola, sin configurar nada.'),
      h('button', { class: 'btn', onclick: () => window.sbcNative.openExternal('https://ollama.com/download') }, icon('download'), 'Abrir ollama.com/download')),
    dk && ollama.status.installed && h('p', { class: 'small muted' }, 'App de escritorio: Ollama se detecta e inicia automáticamente; no hay nada que configurar.'),
    ollama.integrated.on && h('p', { class: 'small muted' }, 'Modo local integrado: la app ya se conecta sola a tu Ollama, sin configurar nada más.'),
    (ollama.status.kind === 'model' || !ollama.status.models.length) && code('Instala el modelo de 2 GB', 'ollama pull qwen2.5:3b'),
    hosted && h('div', { class: 'card stack', style: 'gap:10px' },
      h('strong', null, 'Opción A · App de escritorio (recomendada)'),
      localApp && h('div', { class: 'small', style: 'color:var(--ok)' }, '✓ Detecté que ya está corriendo en tu PC.'),
      h('p', { class: 'small muted' }, 'Descarga la app de Windows: es esta misma app en su propia ventana, detecta tu Ollama sola (incluso lo inicia si está apagado) y se actualiza sola. No hay que configurar nada.'),
      h('a', { class: 'btn primary', href: 'https://github.com/xxvicho9090-sys/skillsbuild-coach/releases/latest', target: '_blank', rel: 'noopener' }, icon('download'), 'Descargar app de escritorio'),
      h('p', { class: 'small muted' }, '¿Ya usas «Iniciar-Coach»? También sirve: abre la versión local en http://localhost:5173.'),
      h('p', { class: 'small muted' }, 'Tus datos de esta web y los de la versión local son independientes: pásalos con Exportar/Importar en Ajustes.')),
    hosted && h('div', { class: 'card stack', style: 'gap:10px' },
      h('strong', null, 'Opción B · Permitir esta web en Ollama'),
      code('Windows (PowerShell)', `setx OLLAMA_ORIGINS "${origin}"`),
      code('macOS (Terminal)', `launchctl setenv OLLAMA_ORIGINS "${origin}"`),
      h('p', { class: 'small muted' }, 'Luego cierra Ollama por completo (bandeja → Quit) y ábrelo otra vez. Chrome puede pedir permiso para "acceder a dispositivos de la red local": acéptalo.')),
    h('p', { class: 'small muted' }, 'Todo el procesamiento ocurre en tu computador: tus apuntes no salen de él.'),
    retry);
}

// Devuelve true si la IA está lista; si no, muestra cómo conectarla.
async function needAI() {
  if (!ollama.status.checked || !ollama.ready()) await ollama.refresh();
  if (ollama.ready()) return true;
  openModal('Conecta tu IA local', ollamaHelp());
  return false;
}

async function runAI(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.name === 'AbortError') { toast('Cancelado'); return null; }
    if (['down', 'origin', 'model'].includes(e.kind)) { await ollama.refresh(); openModal('Conecta tu IA local', ollamaHelp()); }
    else toast(ollama.friendly(e));
    return null;
  }
}

/* ───────── navegación ───────── */

function brandIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M12 4v6l2-1.4L16 10V4"/>';
  return s;
}

const pill = () => h('a', { class: 'pill', href: '#/ajustes', title: 'Estado de Ollama' },
  h('span', { class: `dot ${ollama.ready() ? 'ok' : 'bad'}` }),
  h('span', { class: 'grow' }, ollama.ready() ? 'Ollama conectado' : ollama.status.checked ? 'IA sin conexión' : 'Conectando…'),
  ollama.ready() && h('span', { class: 'muted' }, S.settings.model));

function renderNav(route) {
  const due = dueCards().length;
  const items = [['hoy', 'Biblioteca', 'books'], ['repaso', 'Repaso', 'cards'], ['ajustes', 'Ajustes', 'gear']];
  $('#side').replaceChildren(
    h('a', { class: 'brand', href: '#/hoy' }, brandIcon(), 'Coach'),
    h('nav', { 'aria-label': 'Principal' }, ...items.map(([r, t, ic]) => h('a', { href: '#/' + r, 'aria-current': route === r ? 'page' : null },
      icon(ic), t, r === 'repaso' && due > 0 ? h('span', { class: 'due', 'aria-label': `${due} por repasar` }, due > 99 ? '99+' : due) : null))),
    h('div', { class: 'side-foot' }, h('button', { class: 'btn primary', onclick: () => openImport() }, icon('plus'), 'Nuevo libro'), pill()));
  const fab = $('#fab');
  fab.hidden = route !== 'hoy';
  fab.replaceChildren(icon('plus'));
  fab.onclick = () => openImport();
}

function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const route = parts[0] || 'hoy';
  const views = { hoy: viewBiblioteca, cursos: viewBiblioteca, curso: viewCurso, mod: viewMod, repaso: viewRepaso, ajustes: viewAjustes };
  const nav = { hoy: 'hoy', cursos: 'hoy', curso: 'hoy', mod: 'hoy', repaso: 'repaso', ajustes: 'ajustes' }[route] || 'hoy';
  if (sel.on && !['hoy', 'cursos', 'curso'].includes(route)) { sel.on = false; sel.ids.clear(); }
  let el;
  try { el = (views[route] || viewBiblioteca)(...parts.slice(1)); }
  catch (e) { console.error(e); el = h('div', { class: 'empty' }, h('h3', null, 'Algo salió mal'), h('p', null, e.message)); }
  app.replaceChildren(el);
  renderNav(nav);
  selBar();
  scrollTo(0, 0);
  document.title = 'SkillsBuild Coach';
}
addEventListener('hashchange', render);

/* ───────── Biblioteca ───────── */

const COVERS = ['#2f5d50', '#7a3b2e', '#2e4a6b', '#8a6a2f', '#4f3b6b', '#3d3d3a'];
const coverBg = (id) => COVERS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COVERS.length];
const progressOf = (m) => {
  if (m.done) return 1;
  const p = m.readPos || {};
  return Math.max(0, Math.min(1, p[m.readMode || 'libro'] ?? Math.max(0, ...Object.values(p))));
};
const kindOf = (m) => (m.book ? 'Libro de estudio' : m.sheet ? 'Ficha' : 'Apuntes');
const statusOf = (m) => (m.done ? 'Terminado' : m.book ? (progressOf(m) > 0.02 ? `${Math.round(progressOf(m) * 100)}% leído` : 'Listo para leer') : m.text ? 'Sin convertir en libro' : 'Vacío');

function coverEl(m) {
  return h('div', { class: 'cover', style: `background:${coverBg(m.id)}` },
    h('div', { class: 'ct' }, m.book?.title || m.title),
    h('div', null, h('div', { class: 'tag' }, m.seq ? `Parte ${m.seq}` : kindOf(m)), h('div', { class: 'cp', style: 'margin-top:8px' }, h('i', { style: `width:${Math.round(progressOf(m) * 100)}%` }))));
}
// Selección para borrar libros a elección
const sel = { on: false, ids: new Map() };
function selBar() {
  let bar = $('#selbar');
  if (!sel.on) { bar?.remove(); return; }
  if (!bar) { bar = h('div', { id: 'selbar', class: 'selbar', role: 'region', 'aria-label': 'Libros seleccionados' }); document.body.append(bar); }
  const n = sel.ids.size;
  bar.replaceChildren(
    h('span', { class: 'grow' }, n ? plural(n, 'libro seleccionado', 'libros seleccionados') : 'Toca los libros que quieras borrar'),
    h('button', { class: 'btn small', onclick: () => setSelect(false) }, 'Cancelar'),
    h('button', { class: 'btn small danger', disabled: !n, onclick: () => deleteBooks([...sel.ids.values()]) }, icon('trash'), n ? `Eliminar (${n})` : 'Eliminar'));
}
function setSelect(on) {
  sel.on = on ?? !sel.on;
  sel.ids.clear();
  render();
  selBar();
}

// Borra libros (con sus tarjetas) y permite deshacer durante unos segundos.
function deleteBooks(items, { ask = true, then } = {}) {
  if (!items.length) return;
  const names = items.map((x) => x.m.book?.title || x.m.title);
  if (ask && !confirm(items.length === 1 ? `¿Eliminar «${names[0]}» y sus tarjetas?` : `¿Eliminar ${items.length} libros y sus tarjetas?\n\n${names.slice(0, 6).join('\n')}${names.length > 6 ? '\n…' : ''}`)) return;
  const snap = items.map(({ c, m }) => ({ c, m, index: c.modules.indexOf(m), cards: S.cards.filter((k) => k.mid === m.id) }));
  snap.forEach(({ c, m }) => { removeCards((k) => k.mid === m.id); c.modules = c.modules.filter((x) => x !== m); });
  sel.on = false; sel.ids.clear();
  save();
  then?.();
  render(); selBar();
  toast(items.length === 1 ? 'Libro eliminado' : `${items.length} libros eliminados`, {
    label: 'Deshacer',
    fn: () => {
      snap.sort((a, b) => a.index - b.index).forEach(({ c, m, index, cards }) => {
        if (!S.courses.includes(c)) S.courses.push(c);
        c.modules.splice(Math.max(0, Math.min(index, c.modules.length)), 0, m);
        S.cards.push(...cards);
      });
      save(); render(); toast('Libros restaurados');
    },
  });
}

const bookLink = (c, m) => {
  const label = `${m.book?.title || m.title}. ${statusOf(m)}`;
  const meta = h('div', { class: 'meta' + (m.done ? ' ok' : '') }, statusOf(m));
  if (!sel.on) return h('a', { class: 'vol', href: `#/mod/${c.id}/${m.id}`, 'aria-label': label }, coverEl(m), meta);
  const b = h('button', { class: 'vol selectable' + (sel.ids.has(m.id) ? ' picked' : ''), 'aria-pressed': String(sel.ids.has(m.id)), 'aria-label': label });
  b.append(coverEl(m), meta);
  b.addEventListener('click', () => {
    if (sel.ids.has(m.id)) sel.ids.delete(m.id); else sel.ids.set(m.id, { c, m });
    b.classList.toggle('picked', sel.ids.has(m.id));
    b.setAttribute('aria-pressed', String(sel.ids.has(m.id)));
    selBar();
  });
  return b;
};
const addTile = (label, fn) => h('button', { class: 'book-add', onclick: fn }, icon('upload'), label);

function planFor(c) {
  if (!c.deadline) return null;
  const left = c.modules.filter((m) => !m.done).length;
  if (!left) return null;
  const days = Math.ceil((new Date(c.deadline + 'T23:59:59') - Date.now()) / 86400000);
  if (days <= 0) return `${c.name}: la fecha ya pasó y faltan ${plural(left, 'libro', 'libros')}.`;
  const perWeek = Math.max(1, Math.ceil(left / Math.max(days / 7, 1)));
  return `${c.name}: ${perWeek} ${perWeek === 1 ? 'libro' : 'libros'} por semana para llegar al ${fmtDate(new Date(c.deadline + 'T12:00:00'))}.`;
}

function openNewCourse(after) {
  const name = input('Nombre del curso', { placeholder: 'Ej. IA Generativa con IBM', maxlength: 80 });
  const date = input('Fecha objetivo (opcional)', { type: 'date' });
  const create = () => {
    if (!name.el.value.trim()) { name.el.focus(); return; }
    const c = newCourse(name.el.value.trim(), date.el.value);
    S.courses.push(c); save(); closeModal();
    after ? after(c) : go('#/curso/' + c.id);
  };
  name.el.addEventListener('keydown', (e) => e.key === 'Enter' && create());
  openModal('Nuevo curso', h('div', { class: 'stack' }, name.field, date.field, h('button', { class: 'btn primary block', onclick: create }, 'Crear curso')));
}

function viewBiblioteca() {
  const due = dueCards().length;
  const mods = allModules();
  const doneN = mods.filter((x) => x.mod.done).length;
  const plans = S.courses.map(planFor).filter(Boolean);
  const last = mods.filter((x) => x.mod.lastRead && !x.mod.done).sort((a, b) => b.mod.lastRead - a.mod.lastRead)[0]
    || mods.find((x) => !x.mod.done && x.mod.text);

  const q = h('input', { type: 'search', placeholder: 'Buscar en tus libros', 'aria-label': 'Buscar en tus libros' });
  const body = h('div', { class: 'stack', style: 'gap:28px' });
  const head = h('div', { class: 'lib-head' },
    h('div', null, h('div', { class: 'eyebrow' }, new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })), h('h1', { style: 'margin-top:6px' }, 'Tu biblioteca')),
    h('div', { class: 'tools' }, h('label', { class: 'search' }, icon('search'), q), mods.length > 0 && h('button', { class: 'btn' + (sel.on ? ' ink' : ''), onclick: () => setSelect() }, icon('trash'), sel.on ? 'Listo' : 'Seleccionar'), h('button', { class: 'btn primary', onclick: () => openImport() }, icon('plus'), 'Nuevo libro')));

  const shelves = () => {
    if (!S.courses.length) {
      return [h('div', { class: 'empty' },
        h('h3', null, 'Tu biblioteca está vacía'),
        h('p', null, 'Manda PDFs, documentos o capturas de pantalla de tu curso y la IA los convierte en un libro para leer, con quiz y tarjetas de repaso.'),
        h('div', { class: 'row', style: 'justify-content:center;margin-top:16px' }, h('button', { class: 'btn primary', onclick: () => openImport() }, icon('upload'), 'Importar apuntes')))];
    }
    return S.courses.map((c) => h('section', { class: 'stack', style: 'gap:14px' },
      h('div', { class: 'shelf-head' }, h('h2', null, h('a', { href: '#/curso/' + c.id }, c.name)), h('span', { class: 'muted small' }, `${plural(c.modules.length, 'libro', 'libros')}${c.deadline ? ` · meta ${fmtDate(new Date(c.deadline + 'T12:00:00'))}` : ''}`)),
      h('div', { class: 'shelf' }, c.modules.map((m) => bookLink(c, m)), addTile('Suelta PDFs o capturas', () => openImport({ courseId: c.id })))));
  };

  const results = (term) => {
    const hits = mods.filter(({ mod }) => (mod.title + ' ' + mod.text + ' ' + (mod.book?.title || '')).toLowerCase().includes(term)).slice(0, 30);
    return hits.length ? [h('div', { class: 'list' }, hits.map(({ course, mod }) => {
      const i = mod.text.toLowerCase().indexOf(term);
      const snip = i >= 0 ? '…' + mod.text.slice(Math.max(0, i - 50), i + 90).replace(/\s+/g, ' ') + '…' : '';
      return h('a', { class: 'item', href: `#/mod/${course.id}/${mod.id}` }, h('div', { class: 'grow' }, h('div', { class: 't' }, mod.title), h('div', { class: 'small muted' }, course.name), snip && h('div', { class: 'small muted' }, snip)));
    }))] : [h('div', { class: 'empty' }, 'Sin resultados.')];
  };

  const draw = () => {
    const term = q.value.trim().toLowerCase();
    if (term) { body.replaceChildren(...results(term)); return; }
    body.replaceChildren(...[
      localCard(), installCard(),
      last && h('section', { class: 'hero' },
        h('div', { style: 'width:104px;flex:none' }, coverEl(last.mod)),
        h('div', { class: 'stack grow', style: 'gap:8px' },
          h('div', { class: 'eyebrow' }, last.mod.lastRead ? 'Continúa donde lo dejaste' : 'Empieza por aquí'),
          h('h2', null, last.mod.book?.title || last.mod.title),
          h('div', { class: 'sub' }, `${last.course.name} · ${statusOf(last.mod)}`),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(progressOf(last.mod) * 100)}%` })),
          h('div', { class: 'row wrap', style: 'margin-top:4px' },
            h('a', { class: 'btn light', href: `#/mod/${last.course.id}/${last.mod.id}` }, last.mod.book ? 'Abrir libro' : 'Abrir'),
            due > 0 && h('a', { class: 'btn line', href: '#/repaso' }, `Repasar ${plural(due, 'tarjeta', 'tarjetas')}`)))),
      !last && due > 0 && h('div', { class: 'strip' }, h('div', null, h('strong', null, plural(due, 'tarjeta por repasar', 'tarjetas por repasar')), h('div', { class: 'small muted' }, `≈ ${Math.max(1, Math.round(due * 0.5))} min`)), h('a', { class: 'btn primary', href: '#/repaso' }, 'Repasar')),
      plans.length > 0 && h('div', { class: 'card stack', style: 'gap:6px' }, h('div', { class: 'eyebrow' }, 'Ritmo sugerido'), ...plans.map((p) => h('div', { class: 'small' }, p))),
      !ollama.ready() && S.courses.length > 0 && h('div', { class: 'callout' }, 'La IA local no está conectada: leer y repasar funciona, pero crear libros y preguntas necesita Ollama. ', h('a', { href: '#/ajustes' }, 'Ver cómo conectarla')),
      ...shelves(),
      S.courses.length > 0 && h('div', { class: 'grid3' },
        h('div', { class: 'stat' }, h('b', { style: 'color:var(--warn)' }, streak()), h('span', null, 'días de racha')),
        h('div', { class: 'stat' }, h('b', null, S.cards.length), h('span', null, 'tarjetas')),
        h('div', { class: 'stat' }, h('b', { style: 'color:var(--ok)' }, `${doneN}/${mods.length}`), h('span', null, 'libros terminados'))),
      S.courses.length > 0 && h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => openNewCourse() }, icon('plus'), 'Nuevo curso'),
    ].filter(Boolean));
  };
  q.addEventListener('input', draw);
  draw();
  return h('div', { class: 'stack', style: 'gap:28px' }, head, body);
}

function viewCurso(cid) {
  const c = findCourse(cid);
  if (!c) return h('div', { class: 'empty' }, h('h3', null, 'Curso no encontrado'), h('a', { href: '#/hoy' }, 'Volver a la biblioteca'));
  const done = c.modules.filter((m) => m.done).length;
  const pending = c.modules.filter((m) => !m.processedAt && m.text);
  const name = h('input', { class: 'input', value: c.name, 'aria-label': 'Nombre del curso', maxlength: 80, style: 'font:500 30px var(--display);min-height:56px;letter-spacing:-.01em' });
  name.addEventListener('change', () => { c.name = name.value.trim() || c.name; save(); });
  const date = h('input', { class: 'input', type: 'date', value: c.deadline || '', 'aria-label': 'Fecha objetivo' });
  date.addEventListener('change', () => { c.deadline = date.value; save(); render(); });
  return h('div', { class: 'stack', style: 'gap:22px' },
    h('a', { class: 'back', href: '#/hoy' }, icon('back'), 'Biblioteca'),
    name,
    h('div', { class: 'row wrap' }, h('label', { class: 'field', style: 'min-width:200px' }, 'Fecha objetivo', date),
      h('div', { class: 'field grow', style: 'min-width:200px' }, 'Avance', h('div', { class: 'row', style: 'min-height:44px' }, h('div', { class: 'bar grow' + (done === c.modules.length && done ? ' ok' : '') }, h('i', { style: `width:${c.modules.length ? Math.round(done / c.modules.length * 100) : 0}%` })), h('span', { class: 'small' }, `${done}/${c.modules.length}`)))),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => openImport({ courseId: c.id }) }, icon('upload'), 'Importar aquí'),
      c.modules.length > 0 && h('button', { class: 'btn' + (sel.on ? ' ink' : ''), onclick: () => setSelect() }, icon('trash'), sel.on ? 'Listo' : 'Seleccionar libros'),
      h('button', { class: 'btn', onclick: () => { const m = newModule('Nuevo libro'); c.modules.push(m); save(); go(`#/mod/${c.id}/${m.id}/apuntes`); } }, icon('plus'), 'Libro vacío'),
      pending.length > 0 && h('button', { class: 'btn', onclick: () => processMany(c, pending) }, icon('spark'), `Ficha y preguntas para ${pending.length}`),
      c.modules.length > 1 && h('button', { class: 'btn', onclick: () => orderCourseUI(c) }, icon('books'), 'Ordenar el curso por contenido'),
      c.modules.some((x) => x.text) && h('button', { class: 'btn', onclick: () => courseBookUI(c) }, icon('book'), 'Libro de todo el curso')),
    h('div', { class: 'shelf' }, c.modules.map((m) => bookLink(c, m)), addTile('Suelta PDFs o capturas', () => openImport({ courseId: c.id }))),
    h('button', { class: 'btn danger', style: 'align-self:flex-start', onclick: () => {
      if (!confirm(`¿Eliminar "${c.name}" con sus ${c.modules.length} libros y tarjetas? No se puede deshacer.`)) return;
      removeCards((k) => k.cid === c.id); S.courses = S.courses.filter((x) => x !== c); save(); go('#/hoy');
    } }, icon('trash'), 'Eliminar curso'));
}

async function processMany(course, mods) {
  if (!(await needAI())) return;
  const r = await runAI(() => withBusy('Ordenando con IA', async (set, signal) => {
    let cards = 0;
    for (let i = 0; i < mods.length; i++) {
      const res = await processModule(course, mods[i], { signal, onProgress: (m, p) => set(`${mods[i].title} · ${m}`, (i + p) / mods.length) });
      cards += res.cards;
    }
    return cards;
  }));
  if (r != null) { toast(`Listo: ${plural(r, 'tarjeta nueva', 'tarjetas nuevas')}`); render(); }
}

/* ───────── Importar ───────── */

// Suma contenido nuevo (fotos, PDF, texto) a un libro como fragmentos: la IA los acomoda junto con lo que ya estaba.
function addFragments(m, r) {
  const sep = String.fromCharCode(10, 10);
  if (!m.frags?.length && m.text) {
    m.frags = chunkSections(m.text, 1500, 80).chunks.map((t, i) => ({ id: uid(), name: `Apuntes previos ${i + 1}`, text: t }));
  }
  m.frags ||= [];
  const order = m.plan ? m.plan.groups.flatMap((g) => g.ids) : m.frags.map((f) => f.id);
  m.frags.forEach((f) => { f.prior = true; f.pos = Math.max(0, order.indexOf(f.id)); });
  const add = r.frags?.length ? r.frags : [{ id: uid(), name: r.name, text: r.text }];
  m.frags.push(...add.map((f) => ({ ...f, id: f.id || uid(), prior: false })));
  m.text = (m.text ? m.text + sep : '') + add.map((f) => f.text).join(sep);
  m.plan = null;
  m.processedAt = 0;
}

function openImport({ courseId, modId } = {}) {
  let files = [];
  const list = h('div', { class: 'stack', style: 'gap:8px' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  const drawFiles = () => list.replaceChildren(...files.map((f, i) => h('div', { class: 'filechip' }, icon('file'), h('span', { class: 'grow', style: 'overflow-wrap:anywhere' }, f.name), h('span', { class: 'muted small' }, (f.size / 1024 < 1000 ? Math.round(f.size / 1024) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB')), h('button', { class: 'icon-btn', style: 'width:32px;height:32px', 'aria-label': 'Quitar', onclick: () => { files.splice(i, 1); drawFiles(); } }, icon('x')))));
  const addFiles = (fs) => { files.push(...[...fs].filter((f) => !files.some((g) => g.name === f.name && g.size === f.size))); drawFiles(); };
  fileIn.addEventListener('change', () => { addFiles(fileIn.files); fileIn.value = ''; });
  const drop = h('div', { class: 'drop', role: 'button', tabindex: '0', onclick: () => fileIn.click(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileIn.click()) },
    icon('upload'), h('div', { style: 'color:var(--text);font-weight:500;margin-top:6px' }, 'Elige PDF, Word, texto o capturas'), h('div', { class: 'small' }, 'arrastra o pega (Ctrl+V) capturas de pantalla · puedes elegir varios'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  const onPaste = (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter(isImage);
    if (!imgs.length) return;
    e.preventDefault();
    addFiles(imgs.map((f, i) => new File([f], `Captura ${new Date().toLocaleTimeString('es', { hour12: false }).replace(/:/g, '.')}${imgs.length > 1 ? ' ' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })));
    toast(`${plural(imgs.length, 'captura pegada', 'capturas pegadas')}`);
  };
  document.addEventListener('paste', onPaste);
  $('#modal').addEventListener('close-modal', () => document.removeEventListener('paste', onPaste), { once: true });

  const title = input('Título del texto pegado', { placeholder: 'Opcional' });
  const paste = h('textarea', { placeholder: 'O pega aquí tus apuntes…', 'aria-label': 'Texto pegado', style: 'min-height:110px' });
  const sel = h('select', { 'aria-label': 'Curso' }, ...S.courses.map((c) => h('option', { value: c.id, selected: c.id === courseId }, c.name)), h('option', { value: '__new' }, '+ Curso nuevo…'));
  if (!S.courses.length) sel.value = '__new';
  const newName = input('Nombre del curso nuevo', { placeholder: 'Ej. IA Generativa con IBM', maxlength: 80 });
  const syncNew = () => { newName.field.hidden = sel.value !== '__new'; };
  sel.addEventListener('change', syncNew); syncNew();
  const split = h('select', { 'aria-label': 'Dividir PDFs largos' },
    h('option', { value: 'auto' }, 'Automático (cada 12 págs. si pasa de 30)'), h('option', { value: '0' }, 'No dividir'), h('option', { value: '8' }, 'Cada 8 páginas'), h('option', { value: '20' }, 'Cada 20 páginas'));
  const proc = h('input', { type: 'checkbox', checked: true });
  const bookChk = h('input', { type: 'checkbox', checked: true });
  const ordChk = h('input', { type: 'checkbox', checked: true });
  const reorg = h('input', { type: 'checkbox', checked: true });
  const target = modId ? findMod(findCourseOf(modId), modId) : null;

  const go_ = async () => {
    const text = paste.value.trim();
    if (!files.length && !text) { toast('Elige un archivo o pega texto'); return; }
    let course = modId ? null : findCourse(sel.value);
    if (!modId && !course) {
      if (!newName.el.value.trim()) { newName.el.focus(); toast('Escribe el nombre del curso'); return; }
      course = newCourse(newName.el.value.trim()); S.courses.push(course);
    }
    closeModal();
    const created = [], errors = [];
    await withBusy('Leyendo tus archivos', async (set) => {
      const imgs = files.filter(isImage);
      const sources = [...files.filter((f) => !isImage(f)).map((f) => ({ f })), ...(imgs.length ? [{ imgs }] : []), ...(text ? [{ text }] : [])];
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const label_ = s.f ? s.f.name : s.imgs ? plural(s.imgs.length, 'captura', 'capturas') : 'texto pegado';
        const prog = (p, n, ph) => set(ph ? `${label_} · ${ph}` : `${label_} · página ${p} de ${n}`, (i + Math.min(1, p / n)) / sources.length);
        try {
          let r;
          if (s.imgs) {
            const parts = [];
            for (let k = 0; k < s.imgs.length; k++) {
              const x = await extractFile(s.imgs[k], (p, n, ph) => set(`Captura ${k + 1} de ${s.imgs.length} · ${ph || 'leyendo'}`, (i + (k + Math.min(1, p / n)) / s.imgs.length) / sources.length));
              parts.push({ id: uid(), name: s.imgs[k].name, text: x.text });
            }
            r = { name: title.el.value.trim() || `Capturas ${new Date().toLocaleDateString('es', { day: 'numeric', month: 'short' })}`, pages: null, text: parts.map((x) => x.text).join(String.fromCharCode(10, 10)), frags: parts };
          } else if (s.f) r = await extractFile(s.f, prog);
          else r = { name: title.el.value.trim() || 'Apuntes pegados', pages: null, text: cleanText(s.text) };
          if (r.note) errors.push(`${label_}: ${r.note}`);
          set(label_, (i + 1) / sources.length);
          if (modId) {
            const m = findMod(findCourseOf(modId), modId);
            addFragments(m, r);
            if (!created.includes(m)) created.push(m);
            continue;
          }
          const per = split.value === 'auto' ? (r.pages && r.pages.length > 30 ? 12 : 0) : +split.value;
          if (r.pages && per > 0 && r.pages.length > per) {
            for (let a = 0; a < r.pages.length; a += per) {
              const b = Math.min(a + per, r.pages.length);
              const t = r.pages.slice(a, b).join('\n\n').trim();
              if (t) { const m = newModule(`${r.name} · págs. ${a + 1}–${b}`, t, { name: s.f.name, pages: [a + 1, b] }); course.modules.push(m); created.push(m); }
            }
          } else {
            const m = newModule(r.name, r.text, s.f ? { name: s.f.name, pages: r.pages ? [1, r.pages.length] : null } : s.imgs ? { name: label_, pages: null } : null);
            if (r.frags) m.frags = r.frags;
            course.modules.push(m); created.push(m);
          }
        } catch (e) { errors.push(`${label_}: ${e.message}`); }
      }
    });
    stopOCR();
    save();
    if (errors.length) openModal('Avisos de la importación', h('div', { class: 'stack' }, ...errors.map((e) => h('p', { class: 'small' }, e)), h('button', { class: 'btn primary', onclick: closeModal }, 'Entendido')));
    if (!created.length) { render(); return; }
    toast(modId ? 'Agregado al libro' : `Importado: ${plural(created.length, 'módulo', 'módulos')}`);
    if (modId && reorg.checked) {
      const m = findMod(findCourseOf(modId), modId);
      if (m && (ollama.ready() || (await ollama.refresh()).ok)) {
        await orderMany([m], null, false);
        const ok = await bookMany([m], { style: m.book?.style || 'explained', lang: m.book?.lang || 'es', model: m.book?.model || undefined, verify: true }, findCourse(findCourseOf(modId)));
        go(`#/mod/${findCourseOf(modId)}/${modId}/libro`);
        render();
        if (ok) toast('Libro reorganizado con las fotos nuevas');
        return;
      }
      toast('Agregado. Conecta Ollama para reorganizar el libro con IA.');
    }
    if ((bookChk.checked || proc.checked || ordChk.checked) && !modId) {
      if (ollama.ready() || (await ollama.refresh()).ok) {
        if (ordChk.checked || bookChk.checked || proc.checked) await orderMany(created, course, ordChk.checked);
        if (bookChk.checked) await bookMany(created, { style: 'explained', lang: 'es', verify: true }, course);
        if (proc.checked) await processMany(course, created);
      } else toast('Importado. Conecta Ollama para convertirlo en libro con IA.');
    }
    go(modId ? `#/mod/${findCourseOf(modId)}/${modId}/apuntes` : created.length === 1 ? `#/mod/${course.id}/${created[0].id}` : `#/curso/${course.id}`);
    render();
  };

  openModal(modId ? 'Agregar fotos o archivos' : 'Importar apuntes', h('div', { class: 'stack' },
    drop, fileIn, list, title.field, h('label', { class: 'field' }, 'Texto', paste),
    modId && h('label', { class: 'check' }, reorg, target?.book ? 'Reorganizar el libro con IA (solo reescribe lo que cambió)' : 'Ordenar con IA y crear el libro'),
    !modId && h('label', { class: 'field' }, 'Guardar en', sel), !modId && newName.field,
    !modId && h('label', { class: 'field' }, 'PDFs largos', split),
    !modId && h('label', { class: 'check' }, ordChk, 'Ordenar por lo que dice el contenido (no por el orden en que lo subí)'),
    !modId && h('label', { class: 'check' }, bookChk, 'Convertir en libro con IA (para leer)'),
    !modId && h('label', { class: 'check' }, proc, 'Crear ficha, glosario y preguntas con IA'),
    h('button', { class: 'btn primary block', onclick: go_ }, 'Importar')));
}

const findCourseOf = (mid) => S.courses.find((c) => c.modules.some((m) => m.id === mid))?.id;

/* ───────── Módulo ───────── */

/* ───────── Libro ───────── */

// Entiende y ordena los fragmentos (capturas) de cada módulo por su contenido; opcionalmente ordena los libros del curso.
async function orderMany(mods, course, alsoCourse) {
  const todo = mods.filter((m) => m.frags?.length > 1 && !m.plan);
  if (!todo.length && !(alsoCourse && course && course.modules.length > 1)) return;
  if (!(await needAI())) return;
  await runAI(() => withBusy('Ordenando por contenido', async (set, signal) => {
    for (let i = 0; i < todo.length; i++) {
      await orderModule(todo[i], { signal, onProgress: (msg, p) => set(`${todo.length > 1 ? todo[i].title + ' · ' : ''}${msg}`, (i + p) / (todo.length + 1)) });
    }
    if (alsoCourse && course && course.modules.length > 1) {
      set('Ordenando los libros del curso', todo.length / (todo.length + 1));
      await orderCourse(course, { signal, onProgress: (msg, p) => set(msg, (todo.length + p) / (todo.length + 1)) });
    }
    return true;
  }));
}

async function orderCourseUI(c) {
  if (!(await needAI())) return;
  const ok = await runAI(() => withBusy('Ordenando el curso por contenido', (set, signal) => orderCourse(c, { signal, onProgress: set })));
  if (ok) { toast('Libros ordenados por su contenido'); render(); } else if (ok === false) toast('No pude decidir un orden: revisa los títulos de los libros.');
}

// Junta todo el curso en un solo libro: la IA agrupa los temas de todos los módulos y los ordena.
async function courseBookUI(c) {
  const mods = c.modules.filter((m) => m.text);
  if (!mods.length) return;
  const nm = newModule(`Libro del curso · ${c.name}`, mods.map((m) => m.text).join(String.fromCharCode(10, 10)));
  nm.frags = mods.map((m) => ({ id: uid(), name: m.title, text: m.text }));
  nm.seq = null;
  openBookDialog(c, nm, () => { c.modules.push(nm); save(); });
}

async function bookMany(mods, opts, course) {
  if (!(await needAI())) return false;
  const r = await runAI(() => withBusy('Escribiendo tu libro con IA', async (set, signal) => {
    for (let i = 0; i < mods.length; i++) {
      await makeBook(mods[i], { ...opts, signal, onProgress: (msg, p) => set(`${mods.length > 1 ? mods[i].title + ' · ' : ''}${msg}`, (i + p) / mods.length) });
    }
    return true;
  }));
  if (r) toast(mods.length > 1 ? `${mods.length} libros listos` : 'Tu libro está listo');
  return !!r;
}

function openBookDialog(c, m, beforeCreate) {
  const style = h('select', { 'aria-label': 'Estilo del libro' },
    h('option', { value: 'explained' }, 'Explicado: capítulos, ejemplos e ideas clave (recomendado)'),
    h('option', { value: 'faithful' }, 'Fiel: solo ordenar y redactar lo que dicen mis apuntes'));
  const lang = h('select', { 'aria-label': 'Idioma' }, h('option', { value: 'es' }, 'En español (términos técnicos en inglés)'), h('option', { value: 'orig' }, 'En el idioma original'));
  const models = ollama.status.models;
  const biggest = [...models].sort((a, b) => b.size - a.size)[0];
  const model = h('select', { 'aria-label': 'Modelo de IA' }, models.map((x) => h('option', { value: x.name, selected: x.name === S.settings.model }, `${x.name} · ${bytes(x.size)}${x.name === biggest?.name && models.length > 1 ? ' · mejor redacción, más lento' : ''}`)));
  const verify = h('input', { type: 'checkbox', checked: true });
  openModal('Crear libro con IA', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'La IA entiende de qué trata cada fragmento, los agrupa por tema, decide el orden lógico (aunque las capturas lleguen desordenadas), escribe un capítulo por tema y lo revisa contra tu material. Puedes cancelar.'),
    h('label', { class: 'field' }, 'Estilo', style), h('label', { class: 'field' }, 'Idioma', lang),
    models.length > 0 && h('label', { class: 'field' }, 'Modelo', model),
    h('label', { class: 'check' }, verify, 'Revisar cada capítulo contra mi material (más lento, más fiel)'),
    h('button', { class: 'btn primary block', onclick: async () => {
      closeModal();
      if (m.frags?.length > 1) m.plan = null; // se vuelve a ordenar con lo último que dicen los apuntes
      beforeCreate?.();
      if (await bookMany([m], { style: style.value, lang: lang.value, model: model.value || undefined, verify: verify.checked }, c)) { go(`#/mod/${c.id}/${m.id}/libro`); render(); }
    } }, icon('book'), 'Crear libro')));
}

function tabLibro(c, m) {
  if (!m.book) {
    return h('div', { class: 'stack' },
      h('div', { class: 'card stack' },
        h('h3', null, 'Conviértelo en un libro'),
        h('p', { class: 'muted small' }, 'La IA de tu Ollama reescribe tus apuntes o capturas como un libro de verdad: portada, introducción, capítulos explicados paso a paso con su idea clave, y un cierre. Después lo lees a pantalla completa.'),
        h('button', { class: 'btn primary', disabled: !m.text, onclick: () => openBookDialog(c, m) }, icon('book'), 'Crear libro con IA')),
      m.text && h('button', { class: 'btn', onclick: () => openReader(m) }, 'Leer el texto en pantalla completa'));
  }
  const b = m.book, d = docFromBook(m);
  return h('div', { class: 'stack' },
    h('button', { class: 'btn primary block', onclick: () => openReader(m, 'libro') }, icon('book'), 'Leer como libro en pantalla completa'),
    h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => openImport({ modId: m.id }) }, icon('upload'), 'Agregar más fotos o archivos'),
    m.plan && h('div', { class: 'note' }, h('div', { class: 'k' }, 'ORDENADO POR CONTENIDO'), `La IA leyó ${plural(m.frags?.length || 0, 'fragmento', 'fragmentos')}, entendió de qué trata cada uno y los acomodó en ${plural(m.plan.groups.length, 'tema', 'temas')} en orden lógico${m.plan.changed ? '; el orden final no es el de las capturas' : ''}.`),
    b.truncated > 0 && h('div', { class: 'callout small' }, `El texto era largo: se escribieron los primeros ${b.chapters.length} capítulos de ${b.truncated} partes. Divide el documento en módulos más cortos para cubrirlo todo.`),
    b.fallbacks > 0 && h('div', { class: 'callout small' }, `${plural(b.fallbacks, 'capítulo conserva', 'capítulos conservan')} el texto original porque la IA no logró reescribirlo bien. Prueba "Volver a escribir".`),
    h('div', { class: 'sheet-card book-preview' }, h('div', { class: 'reader-doc book' }, d.nodes)),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => copy(bookMarkdown(m)) }, 'Copiar libro'),
      h('button', { class: 'btn', onclick: () => download(m.title.replace(/[\\/:*?"<>|]+/g, '-') + ' (libro).md', bookMarkdown(m), 'text/markdown') }, icon('download'), 'Descargar .md'),
      h('button', { class: 'btn', onclick: () => openBookDialog(c, m) }, icon('refresh'), 'Volver a escribir')),
    h('p', { class: 'small muted' }, `Escrito el ${fmtDate(b.at)} con ${S.settings.model || 'IA local'} · ${plural(b.chapters.length, 'capítulo', 'capítulos')}`));
}

const TABS = [['libro', 'Libro'], ['ficha', 'Ficha'], ['apuntes', 'Apuntes'], ['conceptos', 'Conceptos'], ['quiz', 'Quiz'], ['feynman', 'Feynman'], ['proyecto', 'Proyecto']];
const quizState = {};

function viewMod(cid, mid, tab) {
  const c = findCourse(cid), m = findMod(cid, mid);
  if (!m) return h('div', { class: 'empty' }, h('h3', null, 'Módulo no encontrado'), h('a', { href: '#/cursos' }, 'Volver a cursos'));
  tab ||= m.book ? 'libro' : m.processedAt ? 'ficha' : 'apuntes';
  const body = { libro: tabLibro, ficha: tabFicha, apuntes: tabApuntes, conceptos: tabConceptos, quiz: tabQuiz, feynman: tabFeynman, proyecto: tabProyecto }[tab] || tabFicha;
  return h('div', { class: 'stack' },
    h('a', { class: 'back', href: '#/curso/' + c.id }, icon('back'), c.name),
    h('div', { class: 'mod-head' },
      coverEl(m),
      h('div', { class: 'stack grow', style: 'gap:10px' },
        h('div', { class: 'eyebrow' }, `${kindOf(m)} · ${wordCount(m.text).toLocaleString('es')} palabras`),
        h('h1', { style: 'font-size:34px' }, m.title),
        h('div', { class: 'small muted' }, statusOf(m)),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', disabled: !m.text, onclick: () => openReader(m) }, icon('book'), m.book ? 'Leer libro' : 'Leer'),
          h('button', { class: 'btn', onclick: () => { m.done = !m.done; save(); logAct(); toast(m.done ? 'Libro terminado' : 'Marcado como pendiente'); render(); } }, icon('check'), m.done ? 'Marcar pendiente' : 'Marcar terminado'),
          h('button', { class: 'btn danger', onclick: () => deleteBooks([{ c, m }], { then: () => go('#/curso/' + c.id) }) }, icon('trash'), 'Eliminar')))),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) => h('a', { class: 'tab', href: `#/mod/${cid}/${mid}/${k}`, 'aria-current': k === tab ? 'page' : null }, t))),
    body(c, m));
}

const sheetMarkdown = (m) => `# ${m.title}\n\n${m.sheet?.summary ? m.sheet.summary + '\n\n' : ''}${(m.sheet?.sections || []).map((s) => `## ${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}`).join('\n\n')}\n${m.concepts.length ? `\n## Glosario\n${m.concepts.map((x) => `- **${x.term}**${x.es ? ` (${x.es})` : ''}: ${x.definition}`).join('\n')}\n` : ''}`;

function tabFicha(c, m) {
  const orden = () => processMany(c, [m]);
  if (!m.sheet) {
    const idx = outline(m.text).filter((s) => s.heading);
    return h('div', { class: 'stack' },
      h('div', { class: 'card stack' },
        h('h3', null, 'Aún no está ordenado'),
        h('p', { class: 'muted small' }, m.text ? 'La IA lee tus apuntes por partes y arma un resumen, ideas clave, glosario, preguntas y tarjetas de repaso.' : 'Primero agrega apuntes en la pestaña Apuntes.'),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', disabled: !m.text, onclick: orden }, icon('spark'), 'Ordenar con IA'),
          h('button', { class: 'btn', disabled: !m.text, onclick: () => openReader(m) }, icon('book'), 'Leer en pantalla completa'))),
      idx.length > 0 && h('div', { class: 'card stack', style: 'gap:8px' }, h('div', { class: 'eyebrow' }, 'Índice detectado (sin IA)'), h('ol', { style: 'margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px' }, idx.slice(0, 40).map((s) => h('li', null, s.heading)))));
  }
  const s = m.sheet;
  return h('div', { class: 'stack' },
    h('button', { class: 'btn primary block', onclick: () => openReader(m) }, icon('book'), 'Leer en pantalla completa'),
    s.truncated > 0 && h('div', { class: 'callout small' }, `El texto era largo: se ordenaron las primeras ${s.sections.length} partes de ${s.truncated}. Divide el documento en módulos más cortos para cubrirlo todo.`),
    (() => {
      const d = docFromSheet(m);
      return h('div', { class: 'stack' },
        d.toc.length > 1 && h('div', { class: 'toc-chips' }, d.toc.map((t, i) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); t.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, h('span', { class: 'mono' }, String(i + 1).padStart(2, '0')), t.title))),
        h('div', { class: 'sheet-card' }, h('div', { class: 'reader-doc' }, d.nodes)));
    })(),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => copy(sheetMarkdown(m)) }, 'Copiar ficha'),
      h('button', { class: 'btn', onclick: () => download(m.title.replace(/[\\/:*?"<>|]+/g, '-') + '.md', sheetMarkdown(m), 'text/markdown') }, icon('download'), 'Descargar .md'),
      h('button', { class: 'btn', onclick: orden }, icon('refresh'), 'Volver a ordenar')),
    h('p', { class: 'small muted' }, `Ordenado el ${fmtDate(m.processedAt)} · ${plural(m.concepts.length, 'concepto', 'conceptos')} · ${plural(m.questions.length, 'pregunta', 'preguntas')}`));
}

function tabApuntes(c, m) {
  const title = h('input', { class: 'input', value: m.title, maxlength: 120, 'aria-label': 'Título del módulo' });
  title.addEventListener('change', () => { m.title = title.value.trim() || m.title; save(); render(); });
  const count = h('span', { class: 'small muted' }, `${wordCount(m.text).toLocaleString('es')} palabras`);
  let t;
  const area = h('textarea', { 'aria-label': 'Apuntes', style: 'min-height:260px', value: m.text, placeholder: 'Pega o escribe tus apuntes, pega una captura (Ctrl+V) o importa un PDF/Word.' });
  area.addEventListener('input', () => { m.text = area.value; count.textContent = `${wordCount(m.text).toLocaleString('es')} palabras`; clearTimeout(t); t = setTimeout(save, 400); });
  area.addEventListener('paste', async (e) => {
    const img = [...(e.clipboardData?.files || [])].find(isImage);
    if (!img) return;
    e.preventDefault();
    const text = await runAI(() => withBusy('Leyendo la captura', async (set) => {
      const r = await recognize(img, (p, msg) => set(msg, p));
      return r;
    }));
    stopOCR();
    if (text) { area.value = (area.value ? area.value.replace(/\s+$/, '') + '\n\n' : '') + text; area.dispatchEvent(new Event('input')); toast('Captura leída y agregada'); }
    else if (text === '') toast('No se encontró texto en la captura');
  });
  area.addEventListener('change', () => { if (m.processedAt) toast('Cambiaste los apuntes: vuelve a ordenarlos para actualizar la ficha.'); });

  const q = h('input', { class: 'input grow', placeholder: 'Pregúntale al tutor sobre estos apuntes…', 'aria-label': 'Duda para el tutor' });
  const ans = h('div', { class: 'note stream', hidden: true });
  const ask = async () => {
    if (!q.value.trim() || !m.text) return;
    if (!(await needAI())) return;
    ans.hidden = false; ans.textContent = 'Pensando…';
    await runAI(() => askTutor(m, q.value.trim(), (_, full) => { ans.textContent = full; }));
    logAct();
  };
  q.addEventListener('keydown', (e) => e.key === 'Enter' && ask());

  const move = h('select', { 'aria-label': 'Mover a otro curso' }, ...S.courses.map((x) => h('option', { value: x.id, selected: x.id === c.id }, x.name)));
  move.addEventListener('change', () => {
    const to = findCourse(move.value); if (!to || to === c) return;
    c.modules = c.modules.filter((x) => x !== m); to.modules.push(m);
    S.cards.forEach((k) => { if (k.mid === m.id) k.cid = to.id; }); save(); go(`#/mod/${to.id}/${m.id}/apuntes`); toast('Movido');
  });

  return h('div', { class: 'stack' },
    h('label', { class: 'field' }, 'Título', title),
    h('label', { class: 'field' }, h('span', { class: 'row between' }, 'Texto', count), area),
    m.source && h('p', { class: 'small muted' }, `Origen: ${m.source.name}${m.source.pages ? ` · págs. ${m.source.pages[0]}–${m.source.pages[1]}` : ''}`),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', disabled: !m.text, onclick: () => openReader(m) }, icon('book'), 'Leer en pantalla completa'),
      h('button', { class: 'btn', onclick: () => openImport({ modId: m.id }) }, icon('upload'), 'Agregar fotos o archivos'),
      h('button', { class: m.done ? 'btn' : 'btn primary', onclick: () => { m.done = !m.done; save(); logAct(); toast(m.done ? 'Módulo terminado' : 'Marcado como pendiente'); render(); } }, icon('check'), m.done ? 'Marcar pendiente' : 'Marcar terminado')),
    h('div', { class: 'card stack' }, h('h3', null, 'Duda para el tutor'), h('div', { class: 'row' }, q, h('button', { class: 'btn primary', onclick: ask }, 'Preguntar')), ans),
    S.courses.length > 1 && h('label', { class: 'field' }, 'Mover a', move),
    h('button', { class: 'btn danger', style: 'align-self:flex-start', onclick: () => {
      if (!confirm(`¿Eliminar "${m.title}" y sus tarjetas?`)) return;
      removeCards((k) => k.mid === m.id); c.modules = c.modules.filter((x) => x !== m); save(); go('#/curso/' + c.id);
    } }, icon('trash'), 'Eliminar módulo'));
}

function tabConceptos(c, m) {
  const front = h('input', { class: 'input', placeholder: 'Pregunta o concepto', 'aria-label': 'Frente de la tarjeta' });
  const back = h('textarea', { placeholder: 'Respuesta', 'aria-label': 'Reverso de la tarjeta', style: 'min-height:80px' });
  const add = () => {
    if (!front.value.trim() || !back.value.trim()) { toast('Completa frente y reverso'); return; }
    addCards(c, m, [{ front: front.value.trim(), back: back.value.trim() }]); front.value = back.value = ''; toast('Tarjeta agregada');
  };
  return h('div', { class: 'stack' },
    m.concepts.length ? h('div', { class: 'card' }, m.concepts.map((x) => h('div', { class: 'term' }, h('b', null, x.term), x.es && h('span', { class: 'es' }, ` · ${x.es}`), h('div', { class: 'muted small', style: 'margin-top:2px' }, x.definition))))
      : h('div', { class: 'empty' }, h('h3', null, 'Sin conceptos todavía'), h('p', null, 'Se generan al ordenar el módulo con IA.'), h('a', { href: `#/mod/${c.id}/${m.id}/ficha` }, 'Ir a la ficha')),
    h('div', { class: 'card stack' }, h('h3', null, 'Tarjeta manual'), front, back, h('button', { class: 'btn', onclick: add }, icon('plus'), 'Agregar tarjeta')));
}

function tabQuiz(c, m) {
  if (!m.questions.length) {
    return h('div', { class: 'empty' }, h('h3', null, 'Sin preguntas todavía'), h('p', null, 'La IA las crea a partir de tus apuntes.'),
      h('button', { class: 'btn primary', disabled: !m.text, onclick: async () => { if (!(await needAI())) return; const n = await runAI(() => withBusy('Creando preguntas', (set, signal) => { set('Leyendo apuntes…', .2); return moreQuestions(m, 5, signal); })); if (n != null) { toast(`${plural(n, 'pregunta nueva', 'preguntas nuevas')}`); render(); } } }, icon('spark'), 'Generar preguntas'));
  }
  let st = quizState[m.id];
  if (!st || st.done) st = quizState[m.id] = { order: m.questions.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, 8), i: 0, score: 0, picked: null, wrong: [], done: false };
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    if (st.i >= st.order.length) {
      st.done = true;
      S.quiz.push({ mid: m.id, score: st.score, total: st.order.length, at: Date.now() }); logAct(st.order.length); save();
      const made = st.wrong.length ? addCards(c, m, st.wrong.map((q) => ({ front: q.q, back: `${q.options[q.answer]}${q.why ? ' — ' + q.why : ''}` }))) : 0;
      wrap.replaceChildren(
        h('div', { class: 'card stack', style: 'text-align:center' }, h('div', { class: 'eyebrow' }, 'Resultado'),
          h('div', { class: 'big', style: `color:${st.score / st.order.length >= .7 ? 'var(--ok)' : 'var(--warn)'}` }, `${st.score}/${st.order.length}`),
          made > 0 && h('p', { class: 'muted small' }, `Agregué ${plural(made, 'tarjeta', 'tarjetas')} con lo que fallaste para tu repaso.`)),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: render }, 'Otra ronda'), h('button', { class: 'btn', onclick: async () => { if (!(await needAI())) return; const n = await runAI(() => withBusy('Creando preguntas', (set, signal) => { set('Leyendo apuntes…', .2); return moreQuestions(m, 4, signal); })); if (n != null) { toast(`${plural(n, 'pregunta nueva', 'preguntas nuevas')}`); render(); } } }, icon('spark'), 'Más preguntas')));
      return;
    }
    const q = m.questions[st.order[st.i]];
    const answered = st.picked != null;
    wrap.replaceChildren(
      h('div', { class: 'row' }, h('div', { class: 'bar grow' }, h('i', { style: `width:${Math.round(st.i / st.order.length * 100)}%` })), h('span', { class: 'mono small muted' }, `${st.i + 1} / ${st.order.length}`)),
      h('div', { class: 'q' }, q.q),
      h('div', { class: 'opts' }, q.options.map((o, k) => h('button', {
        class: 'opt' + (answered ? (k === q.answer ? ' right' : k === st.picked ? ' wrong' : '') : ''), disabled: answered,
        onclick: () => { st.picked = k; if (k === q.answer) st.score++; else st.wrong.push(q); draw(); },
      }, h('span', null, o), answered && k === q.answer ? icon('check') : null))),
      answered && h('div', { class: `note ${st.picked === q.answer ? 'ok' : 'bad'}` }, h('div', { class: 'k' }, st.picked === q.answer ? 'CORRECTO' : 'INCORRECTO'), q.why || `La respuesta correcta es: ${q.options[q.answer]}.`),
      answered && h('button', { class: 'btn primary block', autofocus: true, onclick: () => { st.i++; st.picked = null; draw(); } }, st.i + 1 >= st.order.length ? 'Ver resultado' : 'Siguiente'));
    wrap.querySelector('button[autofocus]')?.focus();
  };
  draw();
  return wrap;
}

function tabFeynman(c, m) {
  const area = h('textarea', { 'aria-label': 'Tu explicación', placeholder: `Explica «${m.title}» con tus propias palabras, como si se lo enseñaras a alguien que empieza…`, style: 'min-height:200px' });
  const out = h('div', { class: 'stack' });
  const run = async () => {
    const text = area.value.trim();
    if (wordCount(text) < 15) { toast('Escribe al menos unas 15 palabras'); return; }
    const parts = [];
    if (m.concepts.length) {
      const cov = coverage(m.concepts, text);
      const hit = cov.filter((x) => x.hit).length;
      parts.push(h('div', { class: 'card stack' }, h('div', { class: 'eyebrow' }, `Cobertura · ${hit} de ${cov.length} conceptos`), h('div', { class: 'chips' }, cov.map((x) => h('span', { class: 'chip ' + (x.hit ? 'hit' : 'miss') }, (x.hit ? '✓ ' : '✗ ') + x.term)))));
    }
    out.replaceChildren(...parts);
    logAct();
    if (!ollama.ready() && !(await ollama.refresh()).ok) { out.append(h('div', { class: 'callout small' }, 'Sin IA conectada: solo te muestro la cobertura. ', h('a', { href: '#/ajustes' }, 'Conectar Ollama'))); return; }
    const r = await runAI(() => withBusy('Evaluando tu explicación', (set, signal) => { set('Comparando con tus apuntes…', .4); return evaluateFeynman(m, text, signal); }));
    if (!r) return;
    const li = (arr) => arr.length ? h('ul', { style: 'margin:6px 0 0;padding-left:20px' }, arr.map((x) => h('li', null, x))) : null;
    out.append(
      h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h3', null, 'Evaluación'), h('span', { class: 'big', style: 'font-size:32px;color:' + (r.score >= 7 ? 'var(--ok)' : 'var(--warn)') }, `${r.score}/10`)),
        r.correct.length > 0 && h('div', null, h('b', null, 'Lo hiciste bien'), li(r.correct)),
        r.missing.length > 0 && h('div', null, h('b', null, 'Te faltó'), li(r.missing)),
        r.errors.length > 0 && h('div', null, h('b', { style: 'color:var(--bad)' }, 'Por corregir'), li(r.errors)),
        r.tip && h('p', { class: 'muted' }, r.tip)));
    if (r.missing.length) addCards(c, m, r.missing.map((x) => ({ front: `Repasa para «${m.title}»`, back: x })));
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Método Feynman: si puedes explicarlo simple, lo entendiste. Lo que te falte se convierte en tarjetas de repaso.'),
    area, h('button', { class: 'btn primary', onclick: run }, icon('spark'), 'Evaluar mi explicación'), out);
}

function tabProyecto(c, m) {
  const box = h('div', { class: 'card prose', hidden: !m.project }, m.project);
  const gen = async () => {
    if (!(await needAI())) return;
    const r = await runAI(() => withBusy('Pensando un mini proyecto', (set, signal) => { set('Mirando los conceptos del módulo…', .3); return makeProject(c, m, signal); }));
    if (r) { m.project = r; save(); box.hidden = false; box.textContent = r; }
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Aplicar lo aprendido en algo concreto lo fija mejor y te deja algo que mostrar junto a la insignia.'),
    box, h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: gen }, icon('spark'), m.project ? 'Proponer otro' : 'Proponer mini proyecto'), m.project && h('button', { class: 'btn', onclick: () => copy(m.project) }, 'Copiar')));
}

/* ───────── Repaso ───────── */

let review = null;
function viewRepaso() {
  if (!review || review.done) review = { queue: dueCards().map((k) => k.id), n: 0, total: 0, shown: false, done: false };
  if (review.total === 0) review.total = review.queue.length;
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    const card = S.cards.find((k) => k.id === review.queue[0]);
    if (!card) {
      review.done = true;
      wrap.replaceChildren(h('div', { class: 'empty' }, h('h3', null, review.n ? '¡Repaso completo!' : 'No hay tarjetas por repasar'), h('p', null, review.n ? `Repasaste ${plural(review.n, 'tarjeta', 'tarjetas')}. Vuelve mañana.` : 'Importa apuntes y ordénalos con IA para crear tarjetas.'), h('a', { class: 'btn primary', href: '#/hoy' }, 'Volver a Hoy')));
      renderNav('repaso'); return;
    }
    const course = findCourse(card.cid), mod = findMod(card.cid, card.mid);
    wrap.replaceChildren(
      h('div', { class: 'row' }, h('a', { class: 'icon-btn', href: '#/hoy', 'aria-label': 'Salir del repaso', style: 'margin-left:-10px' }, icon('x')),
        h('div', { class: 'bar grow' }, h('i', { style: `width:${Math.round(review.n / review.total * 100)}%` })), h('span', { class: 'mono small muted' }, `${review.n} / ${review.total}`)),
      h('div', { class: 'flash' },
        h('div', { class: 'eyebrow' }, `${course?.name || ''}${mod ? ' · ' + mod.title : ''}`),
        h('div', { class: 'front' }, card.front),
        review.shown && h('hr'), review.shown && h('div', { class: 'eyebrow', style: 'color:var(--accent)' }, 'Respuesta'), review.shown && h('div', { class: 'back' }, card.back)),
      review.shown
        ? h('div', { class: 'grades' }, [['Otra vez', 0, 'again'], ['Difícil', 1, ''], ['Bien', 2, 'good'], ['Fácil', 3, 'easy']].map(([t, g, cls], i) => h('button', { class: 'grade ' + cls, title: `Atajo: ${i + 1}`, onclick: () => rate(card, g) }, t, h('small', null, label(card.step, g)))))
        : h('button', { class: 'btn primary block', onclick: () => { review.shown = true; draw(); } }, 'Mostrar respuesta'),
      !review.shown && h('p', { class: 'small muted', style: 'text-align:center' }, 'Intenta responder en voz alta antes de mostrar · Espacio'));
  };
  const rate = (card, g) => {
    grade(card, g); review.queue.shift(); if (g === 0) review.queue.push(card.id); else review.n++; review.shown = false; save(); draw();
  };
  const key = (e) => {
    if (!document.body.contains(wrap)) { removeEventListener('keydown', key); return; }
    if (e.target.matches('input,textarea,select')) return;
    const card = S.cards.find((k) => k.id === review.queue[0]); if (!card || review.done) return;
    if (!review.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); review.shown = true; draw(); }
    else if (review.shown && '1234'.includes(e.key) && e.key) rate(card, +e.key - 1);
  };
  addEventListener('keydown', key);
  draw();
  return wrap;
}

/* ───────── Ajustes ───────── */

function viewAjustes() {
  const url = h('input', { class: 'input mono', value: ollama.desktop.on ? 'Detectado automáticamente en este PC' : ollama.integrated.on ? 'Integrado (servidor local)' : S.settings.url, disabled: ollama.integrated.on || ollama.desktop.on, 'aria-label': 'Dirección de Ollama', spellcheck: 'false', autocapitalize: 'off' });
  const connect = async () => { if (!ollama.integrated.on && !ollama.desktop.on) { S.settings.url = url.value.trim() || 'http://localhost:11434'; save(); } await ollama.refresh(); toast(ollama.status.ok ? 'Conectado a Ollama' : ollama.status.error); render(); };
  url.addEventListener('change', connect);
  const models = ollama.status.models;
  const model = h('select', { 'aria-label': 'Modelo', disabled: !models.length }, models.length ? models.map((x) => h('option', { value: x.name, selected: x.name === S.settings.model }, `${x.name} · ${bytes(x.size)}`)) : [h('option', null, 'Sin modelos (conecta Ollama)')]);
  model.addEventListener('change', () => { S.settings.model = model.value; save(); toast('Modelo: ' + model.value); });
  const ctx = h('select', { 'aria-label': 'Memoria de contexto' }, [2048, 4096, 8192].map((n) => h('option', { value: n, selected: n === S.settings.ctx }, `${n} tokens${n === 4096 ? ' (recomendado)' : n === 8192 ? ' (más RAM)' : ''}`)));
  ctx.addEventListener('change', () => { S.settings.ctx = +ctx.value; save(); });
  const theme = h('select', { 'aria-label': 'Tema' }, [['light', 'Claro · papel (recomendado)'], ['dark', 'Oscuro'], ['auto', 'Automático (sigue a Windows)']].map(([v, t]) => h('option', { value: v, selected: v === S.settings.theme }, t)));
  theme.addEventListener('change', () => { S.settings.theme = theme.value; save(); applyTheme(); });

  const upd = h('div', { class: 'small muted' }, S.meta.lastCheck ? `Última revisión: ${new Date(S.meta.lastCheck).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Aún sin revisar');
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.courses)) throw new Error('no es una copia de SkillsBuild Coach');
      if (!confirm(`Esto reemplaza todo lo actual por la copia (${data.courses.length} cursos). ¿Continuar?`)) return;
      await replaceAll(data); toast('Copia restaurada'); applyTheme(); render();
    } catch (e) { toast('Archivo inválido: ' + e.message); }
  });
  const st = ollama.status;
  return h('div', { class: 'stack' }, h('h1', null, 'Ajustes'),
    h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, 'Ollama (IA local)'), h('span', { class: 'pill' }, h('span', { class: `dot ${st.ok ? 'ok' : 'bad'}` }), st.ok ? 'Conectado' : st.checked ? 'Sin conexión' : 'Revisando…')),
      h('label', { class: 'field' }, 'Dirección', url),
      h('label', { class: 'field' }, 'Modelo', model),
      h('label', { class: 'field' }, 'Memoria de contexto', ctx),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: connect }, icon('refresh'), 'Probar conexión')),
      !st.ok && ollamaHelp()),
    h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, 'Actualizaciones'), h('span', { class: 'mono small muted' }, 'v' + APP_VERSION)),
      upd, h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; const v = await checkUpdate(true); e.target.disabled = false; upd.textContent = 'Última revisión: ahora'; if (v?.notes?.length) toast(v.notes[0]); } }, icon('refresh'), 'Buscar actualizaciones')),
    h('div', { class: 'card stack' }, h('h2', null, 'Apariencia'), h('label', { class: 'field' }, 'Tema', theme), installBtn()),
    h('div', { class: 'card stack' },
      h('h2', null, 'Copia de seguridad'),
      h('p', { class: 'small muted' }, 'Tus datos viven solo en este navegador. Exporta una copia de vez en cuando, sobre todo antes de borrar datos del sitio.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => { download(`skillsbuild-coach-${dayKey()}.json`, JSON.stringify(S), 'application/json'); toast('Copia descargada'); } }, icon('download'), 'Exportar'),
        h('button', { class: 'btn', onclick: () => fileIn.click() }, icon('upload'), 'Importar'), fileIn,
        h('button', { class: 'btn danger', onclick: async () => { if (!confirm('¿Borrar TODOS tus cursos, apuntes y tarjetas de este navegador?')) return; await replaceAll({ settings: S.settings }); toast('Datos borrados'); render(); } }, icon('trash'), 'Borrar todo'))));
}

let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (/^#\/(ajustes|hoy)?$/.test(location.hash)) render(); });
addEventListener('appinstalled', () => { installEvt = null; toast('App instalada'); });
const doInstall = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); };
const installCard = () => !installEvt ? null : h('div', { class: 'card row between', style: 'border-color:var(--accent)' },
  h('div', { class: 'grow' }, h('strong', null, 'Instala la app'), h('div', { class: 'small muted' }, 'Ábrela como programa propio, sin barra del navegador y con acceso sin conexión.')),
  h('button', { class: 'btn primary', onclick: doInstall }, icon('download'), 'Instalar'));
const installBtn = () => installEvt
  ? h('button', { class: 'btn primary', style: 'align-self:flex-start', onclick: doInstall }, icon('download'), 'Instalar como app')
  : matchMedia('(display-mode: standalone)').matches ? h('p', { class: 'small muted' }, 'Ya estás usando la app instalada.') : h('p', { class: 'small muted' }, 'Para instalarla: menú del navegador → "Instalar app" o "Agregar a pantalla de inicio".');

/* ───────── actualizaciones ───────── */

const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
let reloading = false;

async function checkUpdate(manual = false) {
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const v = await res.json();
    S.meta.lastCheck = Date.now(); save();
    if (cmpVer(v.version, APP_VERSION) > 0) showUpdate(v);
    else if (manual) toast(`Estás al día · v${APP_VERSION}`);
    return v;
  } catch {
    if (manual) toast('No se pudo buscar actualizaciones (¿sin conexión?)');
    return null;
  }
}

function showUpdate(v) {
  const el = $('#update');
  el.hidden = false;
  el.replaceChildren(h('span', null, `Hay una versión nueva (v${v.version}). `), h('button', { class: 'btn', onclick: applyUpdate }, 'Actualizar ahora'), h('button', { class: 'btn', style: 'background:transparent;color:inherit;border:1px solid currentColor', onclick: () => { el.hidden = true; } }, 'Después'));
}

async function applyUpdate() {
  await flush();
  if (window.sbcNative) { window.sbcNative.reload(); return; }
  const reg = await navigator.serviceWorker?.getRegistration();
  try { await reg?.update(); } catch { /* sin red */ }
  if (reg?.waiting) { reg.waiting.postMessage('SKIP_WAITING'); setTimeout(() => location.reload(), 1500); }
  else location.reload();
}

async function setupSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) checkUpdate(); });
    });
  } catch { /* sin service worker: la app sigue funcionando */ }
}

/* ───────── arranque ───────── */

(async function boot() {
  await init();
  if (S.meta.themeV !== 2) { S.settings.theme = 'light'; S.meta.themeV = 2; save(); } // el tono papel es el predeterminado
  applyTheme();
  render();
  setupSW();
  if (S.meta.seenVersion && S.meta.seenVersion !== APP_VERSION) {
    fetch('version.json').then((r) => r.json()).then((v) => toast(`Actualizada a v${APP_VERSION}${v.notes?.[0] ? ': ' + v.notes[0] : ''}`)).catch(() => toast('Actualizada a v' + APP_VERSION));
  }
  S.meta.seenVersion = APP_VERSION; save();
  window.sbcNative?.onUpdate((v) => showUpdate({ version: v }));
  await ollama.detectIntegrated();
  await ollama.refresh();
  await detectLocalApp();
  render();
  if (!S.meta.lastCheck || Date.now() - S.meta.lastCheck > 6 * 3600e3) checkUpdate();
  setInterval(checkUpdate, 30 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (Date.now() - S.meta.lastCheck > 600e3) checkUpdate(); } });
})();
