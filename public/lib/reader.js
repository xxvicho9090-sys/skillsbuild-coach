// Documentos ordenados (libro, ficha, texto) + lector a pantalla completa.
import { h, icon } from './dom.js';
import { S, save } from './store.js';
import { outline } from './text.js';

const BULLET = /^\s*(?:[•·▪◦●○■□\-–—*]|\d{1,2}[.)])\s+/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Términos del módulo (original y traducción) para resaltarlos en el texto.
export function termsOf(m) {
  return [...new Set((m.concepts || []).flatMap((c) => [c.term, c.es]).filter((t) => t && t.length >= 3))].sort((a, b) => b.length - a.length);
}

export function highlight(text, terms) {
  if (!terms.length) return [text];
  const re = new RegExp(`(${terms.map(esc).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? h('mark', { class: 'kw' }, part) : part)).filter((x) => x !== '');
}

function blocks(body, terms) {
  const out = [];
  let list = null;
  for (const para of body.split(/\n{2,}/)) {
    for (const line of para.split('\n')) {
      if (BULLET.test(line)) {
        if (!list) { list = h('ul', { class: 'doc-list' }); out.push(list); }
        list.append(h('li', null, ...highlight(line.replace(BULLET, ''), terms)));
      } else { list = null; if (line.trim()) out.push(h('p', null, ...highlight(line.trim(), terms))); }
    }
    list = null;
  }
  return out;
}

const heading = (text, n) => h('h2', { class: 'doc-h' }, n ? h('span', { class: 'doc-n' }, n) : null, text);

// Libro: portada, contenido, introducción, capítulos explicados y cierre.
export function docFromBook(m) {
  const b = m.book, terms = termsOf(m), toc = [], nodes = [];
  const chapterEls = [];
  const cover = h('header', { class: 'book-cover' },
    h('div', { class: 'eyebrow' }, b.style === 'faithful' ? 'Apuntes en formato libro' : 'Libro de estudio'),
    h('h1', null, b.title || m.title),
    b.subtitle ? h('p', { class: 'book-sub' }, b.subtitle) : null,
    h('div', { class: 'book-rule' }));
  nodes.push(cover);
  const contents = h('ol', { class: 'book-contents' });
  const contentsBox = h('div', { class: 'book-toc' }, h('div', { class: 'eyebrow' }, 'Contenido'), contents);
  nodes.push(contentsBox);
  const add = (title, el) => { toc.push({ title, el }); return el; };
  if (b.preface?.length) {
    nodes.push(add('Introducción', h('h2', { class: 'doc-h chapter-h' }, 'Introducción')));
    b.preface.forEach((p, i) => nodes.push(h('p', { class: i === 0 ? 'dropcap' : '' }, ...highlight(p, terms))));
  }
  b.chapters.forEach((c, i) => {
    const hEl = h('h2', { class: 'doc-h chapter-h' }, c.heading);
    chapterEls.push(hEl);
    nodes.push(h('div', { class: 'chapter-n' }, `Capítulo ${i + 1}`), add(c.heading, hEl));
    if (c.lead) nodes.push(h('p', { class: 'lead' }, ...highlight(c.lead, terms)));
    c.paragraphs.forEach((p, k) => nodes.push(h('p', { class: k === 0 && !c.lead ? 'dropcap' : '' }, ...highlight(p, terms))));
    if (c.keyIdea) nodes.push(h('aside', { class: 'keyidea' }, h('div', { class: 'eyebrow' }, 'Idea clave'), h('p', null, ...highlight(c.keyIdea, terms))));
    if (c.remember?.length) nodes.push(h('div', { class: 'remember' }, h('h3', null, 'Para recordar'), h('ul', { class: 'doc-list' }, c.remember.map((r) => h('li', null, ...highlight(r, terms))))));
    if (c.original) nodes.push(h('p', { class: 'small muted' }, '(Este capítulo conserva el texto original porque la IA no logró reescribirlo bien.)'));
  });
  if (b.takeaways?.length) {
    nodes.push(add('Para cerrar', h('h2', { class: 'doc-h chapter-h' }, 'Para cerrar')));
    nodes.push(h('p', null, 'Lo esencial, capítulo por capítulo:'), h('ul', { class: 'doc-list' }, b.takeaways.map((t) => h('li', null, ...highlight(t, terms)))));
    nodes.push(h('p', null, 'Para fijarlo: haz el quiz de este libro y repasa sus tarjetas en los próximos días.'));
  }
  nodes.push(h('p', { class: 'book-note' }, 'Escrito por una IA local a partir de tus apuntes. Puede contener imprecisiones: ante la duda, revisa el modo Texto.'));
  nodes.push(h('div', { class: 'book-end' }, '· · ·'));
  toc.forEach((t, i) => contents.append(h('li', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); t.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t.title))));
  return { nodes, toc, cover: true, book: true };
}

// Ficha: resumen, ideas por tema numeradas y glosario.
export function docFromSheet(m) {
  const terms = termsOf(m), s = m.sheet, toc = [], nodes = [];
  if (s.summary) nodes.push(h('div', { class: 'doc-summary' }, h('div', { class: 'eyebrow' }, 'En resumen'), h('p', null, s.summary)));
  s.sections.forEach((x, i) => {
    const el = heading(x.heading, String(i + 1).padStart(2, '0'));
    toc.push({ title: x.heading, el });
    nodes.push(el, h('ul', { class: 'doc-list' }, x.points.map((p) => h('li', null, ...highlight(p, terms)))));
  });
  if (m.concepts.length) {
    const el = heading('Glosario', '★');
    toc.push({ title: 'Glosario', el });
    nodes.push(el, h('dl', { class: 'doc-gloss' }, m.concepts.flatMap((c) => [
      h('dt', null, c.term, c.es ? h('span', { class: 'es' }, ` · ${c.es}`) : null), h('dd', null, c.definition)])));
  }
  return { nodes, toc };
}

// Texto original con títulos detectados, párrafos y listas (en vez de un bloque corrido).
export function docFromText(m) {
  const terms = termsOf(m), toc = [], nodes = [];
  outline(m.text).forEach((s) => {
    if (s.heading) {
      const el = heading(s.heading);
      toc.push({ title: s.heading, el });
      nodes.push(el);
    }
    nodes.push(...blocks(s.body, terms));
  });
  return { nodes, toc };
}

const LABEL = { libro: 'Libro', ficha: 'Ficha', texto: 'Texto' };

export function openReader(m, want) {
  const modes = [m.book && 'libro', m.sheet && 'ficha', m.text && 'texto'].filter(Boolean);
  if (!modes.length) return;
  let mode = modes.includes(want) ? want : modes.includes(m.readMode) ? m.readMode : modes[0];
  m.lastRead = Date.now();
  const size = () => Math.max(14, Math.min(30, S.settings.readSize || 19));

  const root = h('div', { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Lectura: ${m.title}` });
  const prog = h('i');
  const doc = h('article', { class: 'reader-doc' });
  const tocBox = h('nav', { class: 'reader-toc', 'aria-label': 'Índice' });
  const scroller = h('div', { class: 'reader-scroll', tabindex: '0' }, tocBox, doc);
  const applySize = () => root.style.setProperty('--read-size', size() + 'px');

  const btn = (label, ic, fn) => h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick: fn }, ic);
  const modeBtns = modes.length > 1 ? modes.map((k) => h('button', { class: 'tab', 'aria-pressed': 'false', 'data-mode': k, onclick: () => setMode(k) }, LABEL[k])) : [];
  const tocBtn = btn('Índice', h('span', { class: 'mono', style: 'font-size:13px;font-weight:600' }, '☰'), () => root.classList.toggle('toc-open'));

  const bar = h('header', { class: 'reader-bar' },
    btn('Cerrar lectura (Esc)', icon('x'), () => close()),
    h('div', { class: 'reader-title' }, m.title),
    h('div', { class: 'row', style: 'gap:6px' }, ...modeBtns, tocBtn,
      btn('Letra más chica (-)', h('span', { style: 'font-size:13px;font-weight:600' }, 'A−'), () => bump(-1)),
      btn('Letra más grande (+)', h('span', { style: 'font-size:17px;font-weight:600' }, 'A+'), () => bump(1))),
    h('div', { class: 'reader-progress' }, prog));
  root.append(bar, scroller);

  function bump(d) { S.settings.readSize = Math.max(14, Math.min(30, size() + d)); applySize(); save(); }
  const frac = () => { const max = scroller.scrollHeight - scroller.clientHeight; return max > 0 ? scroller.scrollTop / max : 0; };

  function build() {
    const d = mode === 'libro' ? docFromBook(m) : mode === 'ficha' ? docFromSheet(m) : docFromText(m);
    doc.className = 'reader-doc' + (d.book ? ' book' : '');
    doc.replaceChildren(...(d.cover ? [] : [h('h1', { class: 'doc-title' }, m.title)]), ...d.nodes);
    tocBox.replaceChildren(h('div', { class: 'eyebrow' }, 'Índice'), ...(d.toc.length ? d.toc.map((t, i) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); t.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!matchMedia('(min-width: 1000px)').matches) root.classList.remove('toc-open'); } }, h('span', { class: 'mono' }, String(i + 1).padStart(2, '0')), t.title)) : [h('p', { class: 'small muted' }, 'Sin títulos detectados.')]));
    tocBtn.hidden = !d.toc.length;
    bar.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    requestAnimationFrame(() => { scroller.scrollTop = (m.readPos?.[mode] || 0) * Math.max(0, scroller.scrollHeight - scroller.clientHeight); update(); });
  }
  function setMode(k) { if (k === mode) return; remember(); mode = k; m.readMode = k; build(); }
  function remember() { (m.readPos ||= {})[mode] = frac(); }
  function update() { prog.style.width = Math.round(frac() * 100) + '%'; }
  scroller.addEventListener('scroll', update, { passive: true });

  const onKey = (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') bump(1);
    else if (e.key === '-') bump(-1);
  };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    remember(); m.readMode = mode; save();
    removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    root.remove();
    document.body.style.overflow = '';
  }
  function onFs() { if (!document.fullscreenElement) close(); }

  addEventListener('keydown', onKey);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  applySize();
  build();
  if (matchMedia('(min-width: 1000px)').matches) root.classList.add('toc-open');
  document.addEventListener('fullscreenchange', onFs);
  root.requestFullscreen?.().catch(() => {}); // si el navegador no lo permite, queda a pantalla completa dentro de la ventana
  scroller.focus({ preventScroll: true });
}
