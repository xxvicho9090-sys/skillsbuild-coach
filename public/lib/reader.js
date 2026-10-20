// Documentos ordenados (libro, ficha, texto) + lector a pantalla completa con hojas que se pasan.
import { h, icon } from './dom.js';
import { S, save } from './store.js';
import { outline } from './text.js';

const BULLET = /^\s*(?:[•·▪◦●○■□\-–—*]|\d{1,2}[.)])\s+/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const defaultJump = (el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
// Cada capítulo empieza en una hoja nueva (clase "pb") cuando se lee en modo hojas.
export function docFromBook(m, jump = defaultJump) {
  const b = m.book, terms = termsOf(m), toc = [], nodes = [];
  nodes.push(h('header', { class: 'book-cover' },
    h('div', { class: 'eyebrow' }, b.style === 'faithful' ? 'Apuntes en formato libro' : 'Libro de estudio'),
    h('h1', null, b.title || m.title),
    b.subtitle ? h('p', { class: 'book-sub' }, b.subtitle) : null,
    h('div', { class: 'book-rule' })));
  const contents = h('ol', { class: 'book-contents' });
  nodes.push(h('div', { class: 'book-toc' }, h('div', { class: 'eyebrow' }, 'Contenido'), contents));
  const add = (title, el) => { toc.push({ title, el }); return el; };
  if (b.preface?.length) {
    nodes.push(add('Introducción', h('h2', { class: 'doc-h chapter-h pb' }, 'Introducción')));
    b.preface.forEach((p, i) => nodes.push(h('p', { class: i === 0 ? 'dropcap' : '' }, ...highlight(p, terms))));
  }
  b.chapters.forEach((c, i) => {
    const hEl = h('h2', { class: 'doc-h chapter-h' }, c.heading);
    const num = h('div', { class: 'chapter-n pb' }, `Capítulo ${i + 1}`);
    nodes.push(num, add(c.heading, hEl));
    toc[toc.length - 1].anchor = num;
    if (c.lead) nodes.push(h('p', { class: 'lead' }, ...highlight(c.lead, terms)));
    c.paragraphs.forEach((p, k) => nodes.push(h('p', { class: k === 0 && !c.lead ? 'dropcap' : '' }, ...highlight(p, terms))));
    if (c.keyIdea) nodes.push(h('aside', { class: 'keyidea' }, h('div', { class: 'eyebrow' }, 'Idea clave'), h('p', null, ...highlight(c.keyIdea, terms))));
    if (c.remember?.length) nodes.push(h('div', { class: 'remember' }, h('h3', null, 'Para recordar'), h('ul', { class: 'doc-list' }, c.remember.map((r) => h('li', null, ...highlight(r, terms))))));
    if (c.original) nodes.push(h('p', { class: 'small muted' }, '(Este capítulo conserva el texto original porque la IA no logró reescribirlo bien.)'));
  });
  if (b.takeaways?.length) {
    nodes.push(add('Para cerrar', h('h2', { class: 'doc-h chapter-h pb' }, 'Para cerrar')));
    nodes.push(h('p', null, 'Lo esencial, capítulo por capítulo:'), h('ul', { class: 'doc-list' }, b.takeaways.map((t) => h('li', null, ...highlight(t, terms)))));
    nodes.push(h('p', null, 'Para fijarlo: haz el quiz de este libro y repasa sus tarjetas en los próximos días.'));
  }
  nodes.push(h('p', { class: 'book-note' }, 'Escrito por una IA local a partir de tus apuntes. Puede contener imprecisiones: ante la duda, revisa el modo Texto.'));
  nodes.push(h('div', { class: 'book-end' }, '· · ·'));
  toc.forEach((t) => contents.append(h('li', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); jump(t.anchor || t.el); } }, t.title))));
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
  let layout = S.settings.readLayout === 'scroll' ? 'scroll' : 'pages';
  m.lastRead = Date.now();
  const size = () => Math.max(14, Math.min(30, S.settings.readSize || 19));

  const root = h('div', { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Lectura: ${m.title}` });
  const prog = h('i');
  const doc = h('article', { class: 'reader-doc' });
  const tocBox = h('nav', { class: 'reader-toc', 'aria-label': 'Índice' });
  const scroller = h('div', { class: 'reader-scroll', tabindex: '0' });

  // modo hojas
  const viewport = h('div', { class: 'viewport' });
  const runL = h('div', { class: 'run left' }), runR = h('div', { class: 'run right' });
  const folL = h('div', { class: 'folio left' }), folR = h('div', { class: 'folio right' });
  const spread = h('div', { class: 'spread', tabindex: '0', 'aria-label': 'Hojas del libro' }, h('div', { class: 'sheet' }), h('div', { class: 'spine' }), viewport, runL, runR, folL, folR);
  const prevBtn = h('button', { class: 'turn prev', 'aria-label': 'Hoja anterior', onclick: () => turn(-1) }, icon('back'));
  const nextBtn = h('button', { class: 'turn next', 'aria-label': 'Hoja siguiente', onclick: () => turn(1) }, h('span', { style: 'display:inline-flex;transform:scaleX(-1)' }, icon('back')));
  const zoomer = h('div', { class: 'zoomer' }, spread);
  const slider = h('input', { type: 'range', class: 'pageslider', min: '1', max: '1', value: '1', 'aria-label': 'Ir a la hoja', oninput: (e) => go(+e.target.value - 1) });
  const stage = h('div', { class: 'stage' }, prevBtn, zoomer, nextBtn, slider);
  const overview = h('div', { class: 'overview', hidden: true, role: 'dialog', 'aria-label': 'Vista general de hojas' });

  const applySize = () => root.style.setProperty('--read-size', size() + 'px');
  const btn = (label, ic, fn) => h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick: fn }, ic);
  const modeBtns = modes.length > 1 ? modes.map((k) => h('button', { class: 'tab', 'aria-pressed': 'false', 'data-mode': k, onclick: () => setMode(k) }, LABEL[k])) : [];
  const layoutBtn = h('button', { class: 'tab', title: 'Alternar entre hojas y lectura continua', onclick: () => setLayout(layout === 'pages' ? 'scroll' : 'pages') });
  const tocBtn = btn('Índice', h('span', { class: 'mono', style: 'font-size:13px;font-weight:600' }, '☰'), () => root.classList.toggle('toc-open'));
  const count = h('span', { class: 'pagecount' });
  const overviewBtn = btn('Vista general de hojas (G)', icon('books'), () => toggleOverview());
  const zoomOut = btn('Alejar (Ctrl + rueda)', h('span', { style: 'font-size:20px;font-weight:600' }, '−'), () => setZoom(zoom / 1.25));
  const zoomLabel = h('button', { class: 'zoomlabel', title: 'Restablecer zoom', onclick: () => setZoom(1, true) }, '100%');
  const zoomIn = btn('Acercar (Ctrl + rueda)', h('span', { style: 'font-size:20px;font-weight:600' }, '+'), () => setZoom(zoom * 1.25));
  const pagedOnly = [overviewBtn, zoomOut, zoomLabel, zoomIn, count];

  const bar = h('header', { class: 'reader-bar' },
    btn('Cerrar lectura (Esc)', icon('x'), () => close()),
    h('div', { class: 'reader-title' }, m.title),
    count,
    h('div', { class: 'row', style: 'gap:6px' }, ...modeBtns, layoutBtn, tocBtn, overviewBtn, zoomOut, zoomLabel, zoomIn,
      btn('Letra más chica (-)', h('span', { style: 'font-size:13px;font-weight:600' }, 'A−'), () => bump(-1)),
      btn('Letra más grande (+)', h('span', { style: 'font-size:17px;font-weight:600' }, 'A+'), () => bump(1))),
    h('div', { class: 'reader-progress' }, prog));
  root.append(bar, scroller, stage, overview);

  // ───── estado de las hojas
  let p = 0, total = 1, ppv = 1, pw = 600, chapters = [];
  let geo = { pad: 30, top: 46, vh: 400, cw: 400, ph: 500 };
  let zoom = 1, panX = 0, panY = 0;
  function applyZoom() {
    zoomer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    zoomer.classList.toggle('zoomed', zoom > 1.01);
  }
  function setZoom(z, reset) {
    zoom = reset ? 1 : Math.max(0.4, Math.min(3, z));
    if (zoom <= 1.01) { panX = 0; panY = 0; }
    applyZoom();
  }
  const clamp = (i) => Math.max(0, Math.min(total - 1, i));
  const fracNow = () => {
    if (layout === 'pages') return total > 1 ? p / (total - 1) : 0;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return max > 0 ? scroller.scrollTop / max : 0;
  };

  function jump(el) {
    root.classList.remove('toc-open');
    if (layout === 'pages') go(Math.floor((el.offsetLeft + 2) / pw));
    else defaultJump(el);
  }

  function relayout(frac) {
    if (layout !== 'pages') return;
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    ppv = W >= 900 ? 2 : 1;
    const maxW = ppv === 2 ? Math.min(1240, W - 150) : Math.min(W - 8, 680);
    pw = Math.floor(ppv === 2 ? maxW / 2 : maxW);
    const ph = Math.min(H - 28, 1000);
    const pad = Math.max(20, Math.min(48, Math.round(pw * 0.085)));
    const cw = pw - 2 * pad;
    const top = 46, bottom = 44;
    const vh = Math.max(120, ph - top - bottom);
    const vw = (ppv - 1) * pw + cw;
    geo = { pad, top, vh, cw, ph };
    spread.style.cssText = `width:${pw * ppv}px;height:${ph}px;--pw:${pw}px;--pad:${pad}px`;
    spread.classList.toggle('single', ppv === 1);
    viewport.style.cssText = `left:${pad}px;top:${top}px;width:${vw}px;height:${vh}px`;
    doc.style.cssText = `width:${vw}px;height:${vh}px;column-count:${ppv};column-gap:${2 * pad}px;column-fill:auto`;
    const cols = Math.round((doc.scrollWidth - cw) / pw) + 1;
    total = Math.max(1, cols);
    chapters = [...doc.querySelectorAll('.chapter-h')].map((el) => ({ title: el.textContent, page: Math.floor((el.offsetLeft + 2) / pw) }));
    go(frac != null ? Math.round(frac * (total - 1)) : p, false);
  }

  function go(i, animate = true) {
    p = clamp(i);
    if (ppv === 2) p -= p % 2;
    doc.style.transition = animate ? '' : 'none';
    doc.style.transform = `translateX(${-p * pw}px)`;
    if (!animate) requestAnimationFrame(() => { doc.style.transition = ''; });
    const last = Math.min(total, p + ppv);
    const chapAt = (pg) => [...chapters].reverse().find((c) => c.page <= pg)?.title || '';
    folL.textContent = String(p + 1);
    folR.textContent = p + 2 <= total && ppv === 2 ? String(p + 2) : '';
    runL.textContent = m.book?.title || m.title;
    runR.textContent = chapAt(last - 1);
    slider.max = String(total); slider.step = String(ppv); slider.value = String(p + 1);
    count.textContent = `Hoja ${p + 1}${ppv === 2 && p + 2 <= total ? '–' + (p + 2) : ''} de ${total}`;
    prog.style.width = Math.round((total > 1 ? (p + ppv - 1) / (total - 1) : 1) * 100) + '%';
    prevBtn.disabled = p <= 0;
    nextBtn.disabled = p + ppv >= total;
  }
  const turn = (dir) => go(p + dir * ppv);

  // ───── construcción del contenido
  function build(restore = true) {
    const frac = restore ? (m.readPos?.[mode] || 0) : 0;
    const d = mode === 'libro' ? docFromBook(m, jump) : mode === 'ficha' ? docFromSheet(m) : docFromText(m);
    doc.className = 'reader-doc' + (d.book ? ' book' : '');
    doc.replaceChildren(...(d.cover ? [] : [h('h1', { class: 'doc-title' }, m.title)]), ...d.nodes);
    tocBox.replaceChildren(h('div', { class: 'eyebrow' }, 'Índice'), ...(d.toc.length ? d.toc.map((t, i) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); jump(t.anchor || t.el); } }, h('span', { class: 'mono' }, String(i + 1).padStart(2, '0')), t.title)) : [h('p', { class: 'small muted' }, 'Sin títulos detectados.')]));
    tocBtn.hidden = !d.toc.length;
    bar.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    place();
    if (layout === 'pages') relayout(frac);
    else requestAnimationFrame(() => { scroller.scrollTop = frac * Math.max(0, scroller.scrollHeight - scroller.clientHeight); updateScroll(); });
  }

  function place() {
    const paged = layout === 'pages';
    root.classList.toggle('paged', paged);
    scroller.hidden = paged;
    stage.hidden = !paged;
    pagedOnly.forEach((b) => { b.hidden = !paged; });
    if (!paged) { toggleOverview(false); setZoom(1, true); }
    layoutBtn.textContent = paged ? 'Hojas' : 'Continuo';
    layoutBtn.setAttribute('aria-pressed', String(paged));
    if (paged) { viewport.replaceChildren(doc); root.append(tocBox); }
    else { doc.removeAttribute('style'); scroller.replaceChildren(tocBox, doc); }
  }

  function setMode(k) { if (k === mode) return; remember(); mode = k; m.readMode = k; build(true); }
  function setLayout(l) {
    if (l === layout) return;
    const f = fracNow();
    layout = l; S.settings.readLayout = l; save();
    m.readPos = { ...(m.readPos || {}), [mode]: f };
    place();
    if (l === 'pages') relayout(f);
    else requestAnimationFrame(() => { scroller.scrollTop = f * Math.max(0, scroller.scrollHeight - scroller.clientHeight); updateScroll(); });
  }
  function bump(d) { const f = fracNow(); S.settings.readSize = Math.max(14, Math.min(30, size() + d)); applySize(); save(); if (layout === 'pages') requestAnimationFrame(() => relayout(f)); }
  function remember() { (m.readPos ||= {})[mode] = fracNow(); }
  function updateScroll() { prog.style.width = Math.round(fracNow() * 100) + '%'; }
  scroller.addEventListener('scroll', updateScroll, { passive: true });

  // gestos: deslizar pasa la hoja; pellizco o Ctrl+rueda hacen zoom; con zoom se arrastra para moverse
  const ptrs = new Map();
  let pinch0 = null, drag = null, wheelLock = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.turn, .pageslider, a, button, input')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; drag = null; }
    else drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; setZoom(pinch0.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d); }
    else if (drag && zoom > 1.01) { panX = drag.px + e.clientX - drag.x; panY = drag.py + e.clientY - drag.y; applyZoom(); }
  });
  const endPtr = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const wasPinch = ptrs.size > 1;
    ptrs.delete(e.pointerId);
    if (wasPinch) { pinch0 = null; drag = null; return; }
    if (drag && zoom <= 1.01) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
    }
    drag = null;
  };
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);
  spread.addEventListener('dblclick', () => setZoom(zoom > 1.01 ? 1 : 1.7, zoom > 1.01));
  stage.addEventListener('wheel', (e) => {
    if (layout !== 'pages') return;
    if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); return; }
    if (zoom > 1.01) { panX -= e.deltaX; panY -= e.deltaY; applyZoom(); return; }
    if (Date.now() < wheelLock || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 20) return;
    wheelLock = Date.now() + 450;
    turn((e.deltaY || e.deltaX) > 0 ? 1 : -1);
  }, { passive: false });

  // vista general: todas las hojas en miniatura para saltar a cualquiera
  let io = null;
  function toggleOverview(force) {
    const open = force ?? overview.hidden;
    if (!open) { overview.hidden = true; io?.disconnect(); return; }
    if (layout !== 'pages') return;
    const tw = ppv === 1 ? 118 : 150, sc = tw / pw, th = Math.round(geo.ph * sc);
    io?.disconnect();
    io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const t = en.target;
      io.unobserve(t);
      const i = +t.dataset.i;
      const clone = doc.cloneNode(true);
      clone.style.transition = 'none';
      clone.style.transform = `translateX(${-i * pw}px)`;
      t.querySelector('.thumb-paper').append(h('div', { class: 'thumb-in', style: `width:${pw}px;height:${geo.ph}px;transform:scale(${sc})` },
        h('div', { class: 'thumb-clip', style: `left:${geo.pad}px;top:${geo.top}px;width:${geo.cw}px;height:${geo.vh}px` }, clone)));
    }), { root: overview, rootMargin: '300px' });
    const items = [];
    for (let i = 0; i < total; i++) {
      const cur = i >= p && i < p + ppv;
      items.push(h('button', { class: 'thumb' + (cur ? ' current' : ''), 'data-i': String(i), 'aria-label': `Ir a la hoja ${i + 1}`, onclick: () => { toggleOverview(false); go(i); } },
        h('div', { class: 'thumb-paper', style: `width:${tw}px;height:${th}px` }), h('span', null, String(i + 1))));
    }
    overview.replaceChildren(
      h('div', { class: 'overview-head' }, h('strong', null, 'Vista general'), h('span', { class: 'muted small grow' }, `${total} hojas · toca una para ir`), h('button', { class: 'btn small', onclick: () => toggleOverview(false) }, 'Cerrar')),
      h('div', { class: 'thumbs' }, items));
    overview.hidden = false;
    items.forEach((t) => io.observe(t));
    overview.querySelector('.thumb.current')?.scrollIntoView({ block: 'center' });
  }

  const onKey = (e) => {
    if (e.target?.matches?.('input,textarea,select')) return;
    if (e.key === 'Escape') { if (!overview.hidden) toggleOverview(false); else if (root.classList.contains('toc-open')) root.classList.remove('toc-open'); else close(); return; }
    if (e.key === 'g' || e.key === 'G') { toggleOverview(); return; }
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(1, true); return; }
    if (e.key === '+' || e.key === '=') bump(1);
    else if (e.key === '-') bump(-1);
    else if (layout === 'pages') {
      if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); turn(1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); turn(-1); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(total - 1); }
    }
  };
  let closed = false, resizeT;
  const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => relayout(fracNow()), 120); });
  function close() {
    if (closed) return;
    closed = true;
    remember(); m.readMode = mode; save();
    removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFs);
    ro.disconnect();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    root.remove();
    document.body.style.overflow = '';
  }
  function onFs() { if (!document.fullscreenElement) close(); }

  addEventListener('keydown', onKey);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  applySize();
  if (matchMedia('(min-width: 1000px)').matches && layout === 'scroll') root.classList.add('toc-open');
  build(true);
  ro.observe(stage);
  document.fonts?.ready.then(() => { if (!closed) relayout(fracNow()); });
  document.addEventListener('fullscreenchange', onFs);
  root.requestFullscreen?.().catch(() => {}); // si el navegador no lo permite, queda a pantalla completa dentro de la ventana
  (layout === 'pages' ? spread : scroller).focus({ preventScroll: true });
}
