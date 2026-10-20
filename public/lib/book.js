// Libro de estudio con IA: entiende de qué trata cada fragmento, los agrupa por tema, decide el orden
// lógico (aunque las capturas lleguen desordenadas), escribe cada capítulo y lo revisa contra tu material.
import { chatJSON } from './ollama.js';
import { chunkSections, words } from './text.js';
import { save, logAct } from './store.js';

const str = { type: 'string' };
const list = { type: 'array', items: str };
const SYS = 'Eres un autor de libros de estudio claros, ordenados y didácticos. Explicas con palabras sencillas, en prosa, y eres fiel al material: no inventas datos, cifras ni citas.';
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* ───────── limpieza determinista del texto ───────── */

// Arregla lo típico de OCR y de modelos chicos: espacios, signos, mayúsculas iniciales, "lA" por "IA".
export function polish(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]»])/g, '$1')
    .replace(/([(\[¿¡«])\s+/g, '$1')
    .replace(/([,;:!?])(?=\p{L})/gu, '$1 ')
    .replace(/\blA\b/g, 'IA')
    .replace(/\s*[|¦]\s*/g, ' ')
    .replace(/\.{4,}/g, '…')
    .replace(/(\p{L})\1{3,}/gu, '$1$1')
    .replace(/(\S+)([.!?])\s+(\p{Ll})/gu, (m, w, p, c) => (/^\p{L}{1,3}$/u.test(w) ? m : `${w}${p} ${c.toUpperCase()}`))
    .replace(/^(\p{Ll})/u, (c) => c.toUpperCase())
    .trim();
}
const polishAll = (arr) => (arr || []).map((p) => polish(String(p ?? '').replace(/^\s*\d{1,2}[.)]\s+/, ''))).filter((p) => p.length > 1);

// Verificación sin IA: una oración se queda solo si sus palabras clave aparecen en el material del capítulo.
// Así se caen los ejemplos y datos que el modelo se inventó.
const stem = (w) => w.slice(0, 5);
function filterUnsupported(paragraphs, source) {
  const src = new Set(words(source).map(stem));
  const score = (sent) => {
    const ws = words(sent).filter((w) => w.length >= 5);
    return ws.length < 4 ? 1 : ws.filter((w) => src.has(stem(w))).length / ws.length;
  };
  const before = paragraphs.join(' ').length;
  for (const min of [0.45, 0.3]) {
    const out = paragraphs.map((p) => p.split(/(?<=[.!?])\s+/).filter((t) => score(t) >= min).join(' ')).filter((p) => p.trim().length > 1);
    if (out.length && out.join(' ').length >= before * 0.35) return out;
  }
  return paragraphs;
}

// El modelo a veces mete "la idea clave" o "recuerda…" dentro de los párrafos: eso ya va en su propio recuadro.
const META = /^\s*(la idea (m[aá]s )?(importante|clave|principal)|idea clave|recuerda|para recordar|puntos clave|en resumen,? (los )?puntos)/i;
const noMeta = (paras) => { const out = paras.filter((p) => !META.test(p)); return out.length ? out : paras; };

// Un título de diapositiva o apunte: primera línea corta, sin punto final, con más texto debajo.
function headingOf(text) {
  const lines = String(text).trim().split(/\n/);
  const f = (lines[0] || '').trim();
  return lines.length > 1 && f.length >= 3 && f.length <= 90 && !/[.,;:]$/.test(f) ? polish(f) : '';
}
// Cuánto texto merece el capítulo según el material (el modelo chico rellena y se repite si no se le acota).
const targetParas = (len) => Math.max(1, Math.min(6, Math.ceil(len / 300)));
// Quita oraciones repetidas (o casi) dentro del capítulo.
function dedupeSentences(paragraphs) {
  const kept = [];
  const out = paragraphs.map((p) => p.split(/(?<=[.!?])\s+/).filter((t) => {
    if (kept.some((k) => jaccard(k, t) >= 0.7)) return false;
    kept.push(t);
    return true;
  }).join(' ')).filter((p) => p.trim().length > 1);
  return out.length ? out : paragraphs;
}

// Párrafos larguísimos se parten por oraciones para que se lean como libro.
function splitLong(paragraphs, max = 560) {
  return paragraphs.flatMap((p) => {
    if (p.length <= max) return [p];
    const sents = p.split(/(?<=[.!?])\s+/);
    const out = [];
    let cur = '';
    for (const t of sents) {
      if (cur && cur.length + t.length > max * 0.75) { out.push(cur.trim()); cur = ''; }
      cur += t + ' ';
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  });
}

/* ───────── entender y ordenar los fragmentos ───────── */

const LABEL = {
  type: 'object',
  properties: { title: str, topic: str, stage: { type: 'integer' }, number: { type: 'integer' }, opensMidSentence: { type: 'boolean' }, endsMidSentence: { type: 'boolean' } },
  required: ['title', 'topic', 'stage', 'number', 'opensMidSentence', 'endsMidSentence'],
};
const ORDER = { type: 'object', properties: { order: { type: 'array', items: { type: 'integer' } } }, required: ['order'] };

// Número explícito (módulo, lección, capítulo, paso, página…) si el texto lo trae.
export function explicitNumber(text) {
  const t = String(text).slice(0, 400);
  const m = t.match(/\b(?:m[oó]dulo|lecci[oó]n|cap[ií]tulo|unidad|paso|parte|tema|secci[oó]n)\s*(?:n[º°.]?\s*)?(\d{1,3})\b/i) || t.match(/^\s*(\d{1,2})[.)]\s+\p{Lu}/mu);
  return m ? +m[1] : 0;
}

// Pistas del propio texto (más confiables que el modelo chico): el título delata si abre, define, aplica o cierra.
function cueStage(text) {
  const head = String(text).trim().split(/\n/)[0].slice(0, 120);
  if (/introducci[oó]n|por qu[eé]|bienvenid|objetivos?\b|qu[eé] (veremos|aprender)|presentaci[oó]n|contexto/i.test(head)) return 1;
  if (/conclusi[oó]n|en resumen|resumen|para (cerrar|recordar)|recapitul|siguientes? pasos?|cierre|lo esencial/i.test(head)) return 5;
  if (/ejemplos?\b|caso (pr[aá]ctico|de estudio)|aplicaci[oó]n|aplicaciones|pr[aá]ctica|demostraci[oó]n|ejercicio/i.test(head)) return 4;
  if (/principios|conceptos|definici[oó]n|definiciones|qu[eé] es\b|fundamentos|tipos de|glosario/i.test(head)) return 2;
  return 0;
}
// Frase cortada: se decide por el texto mismo (si termina sin punto / si empieza en minúscula).
const endsOpen = (t) => !/[.!?:;»"')\]…]$/.test(String(t).trim());
const opensOpen = (t) => /^\p{Ll}/u.test(String(t).trim());

async function labelUnit(u, { signal, model }) {
  let r = null;
  try {
    r = await chatJSON({
      signal, model, schema: LABEL, system: SYS, temperature: 0.1,
      user: `Fragmento de apuntes (puede venir de una captura de pantalla; el orden en que llegaron las capturas es desconocido):\n"""\n${u.text.slice(0, 1400)}\n"""\n\nIndica:\n- title: título corto del subtema (máximo 8 palabras)\n- topic: el tema general al que pertenece (2 a 4 palabras, sin artículos)\n- stage: 1 si es introducción o contexto; 2 si define conceptos; 3 si desarrolla el tema; 4 si da ejemplos o aplicaciones; 5 si es conclusión o resumen\n- number: el número de módulo, lección, capítulo, paso o página que aparezca escrito en el texto (0 si no hay ninguno)\n- opensMidSentence: true si el texto empieza a mitad de una frase o idea\n- endsMidSentence: true si el texto termina cortado a mitad de una frase o idea`,
    });
  } catch (e) { if (e.name === 'AbortError') throw e; }
  const num = explicitNumber(u.text) || Math.max(0, +r?.number || 0);
  return {
    title: clean(r?.title) || clean(u.text.split('\n')[0]).slice(0, 70) || 'Fragmento',
    topic: clean(r?.topic).toLowerCase() || '',
    stage: cueStage(u.text) || Math.min(5, Math.max(1, +r?.stage || 3)),
    number: num,
    opens: opensOpen(u.text),
    ends: endsOpen(u.text),
  };
}

const jaccard = (a, b) => {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let i = 0;
  A.forEach((w) => { if (B.has(w)) i++; });
  return i / (A.size + B.size - i);
};

// Ordena los grupos con la IA; solo se acepta una permutación válida, si no se usa el orden determinista.
async function aiOrder(items, { signal, model }, what) {
  if (items.length < 2) return items.map((_, i) => i);
  try {
    const r = await chatJSON({
      signal, model, schema: ORDER, system: SYS, temperature: 0.1,
      user: `Estos son los ${what} de un curso, en desorden:\n${items.map((t, i) => `${i}. ${t}`).join('\n')}\n\nOrdénalos en la secuencia de estudio más lógica: introducción y fundamentos primero, luego los conceptos, después el desarrollo y las aplicaciones, y al final la conclusión. Si un título trae un número (módulo, lección, paso), respétalo. Devuelve order: la lista de todos los índices en el orden correcto, sin repetir ninguno.`,
    });
    const seen = new Set();
    const ord = (r.order || []).filter((i) => Number.isInteger(i) && i >= 0 && i < items.length && !seen.has(i) && seen.add(i));
    if (ord.length >= items.length * 0.7) { items.forEach((_, i) => { if (!seen.has(i)) ord.push(i); }); return ord; }
  } catch (e) { if (e.name === 'AbortError') throw e; }
  return null;
}

/**
 * Lee cada fragmento, los agrupa por tema y decide el orden por lo que dicen (no por el orden en que llegaron).
 * Deja el plan en mod.plan y reescribe mod.text en ese orden.
 */
export async function orderModule(mod, { signal, onProgress, model } = {}) {
  const frags = mod.frags || [];
  if (frags.length < 2) return null;
  const labels = [];
  for (let i = 0; i < frags.length; i++) {
    onProgress?.(`Entendiendo la captura ${i + 1} de ${frags.length}`, (i / frags.length) * 0.7);
    labels.push(await labelUnit(frags[i], { signal, model }));
  }
  onProgress?.('Agrupando por tema y ordenando', 0.72);
  // 1) frases cortadas: un fragmento que empieza a mitad de idea se pega al que quedó abierto
  const next = new Map(), prev = new Map();
  frags.forEach((_, b) => {
    if (!labels[b].opens) return;
    const cands = frags.map((_, a) => a).filter((a) => a !== b && labels[a].ends && !next.has(a) && next.get(b) !== a);
    if (!cands.length) return;
    const score = (a) => jaccard(labels[a].topic + ' ' + labels[a].title, labels[b].topic + ' ' + labels[b].title) - Math.abs(labels[a].stage - labels[b].stage) * 0.05;
    const a = cands.sort((x, y) => score(y) - score(x))[0];
    // sin ciclos
    let c = a; while (prev.has(c)) c = prev.get(c);
    if (c === b) return;
    next.set(a, b); prev.set(b, a);
  });
  const chains = [];
  frags.forEach((_, i) => {
    if (prev.has(i)) return;
    const ids = [i];
    while (next.has(ids[ids.length - 1])) ids.push(next.get(ids[ids.length - 1]));
    chains.push({ ids, head: i });
  });
  const lab = (c) => {
    const ls = c.ids.map((i) => labels[i]);
    return { title: ls[0].title, topic: ls[0].topic, stage: ls.reduce((x, l) => x + l.stage, 0) / ls.length, number: Math.min(...ls.map((l) => l.number || 9999)) };
  };
  chains.forEach((c) => Object.assign(c, lab(c)));
  // 2) la introducción abre y la conclusión cierra; el resto se agrupa por tema
  const intro = chains.filter((c) => c.stage <= 1.5);
  const outro = chains.filter((c) => c.stage >= 4.5);
  const middle = chains.filter((c) => !intro.includes(c) && !outro.includes(c));
  const bySeq = (x, y) => (x.number < 9999 && y.number < 9999 ? x.number - y.number : x.stage - y.stage) || x.head - y.head;
  const groups = [];
  middle.forEach((c) => {
    const g = groups.find((x) => jaccard(x.topic, c.topic) >= 0.5 || (c.topic && x.topic === c.topic));
    if (g) g.chains.push(c); else groups.push({ topic: c.topic || c.title, chains: [c] });
  });
  const pack = (cs, title) => {
    cs.sort(bySeq);
    const ids = cs.flatMap((c) => c.ids);
    return { topic: cs[0].topic, title: title || cs[0].title, ids, rank: Math.min(...cs.map((c) => c.number)), stage: cs.reduce((x, c) => x + c.stage, 0) / cs.length };
  };
  const mids = groups.map((g) => pack(g.chains));
  // 3) orden de los temas del medio: numeración explícita si la hay; si no, la IA; si falla, por etapa
  let method = 'numeros';
  let midOrdered = [...mids];
  if (mids.length > 1) {
    if (mids.every((g) => g.rank < 9999)) midOrdered.sort((x, y) => x.rank - y.rank);
    else {
      // primero por etapa (fundamentos -> conceptos -> desarrollo -> aplicaciones); la IA ordena los temas de una misma etapa
      const bands = new Map();
      mids.forEach((g) => { const k = Math.round(g.stage); bands.set(k, [...(bands.get(k) || []), g]); });
      midOrdered = [];
      for (const k of [...bands.keys()].sort((x, y) => x - y)) {
        const band = bands.get(k);
        if (band.length > 1) {
          const idx = await aiOrder(band.map((g) => `${g.title} (tema: ${g.topic})`), { signal, model }, 'temas');
          if (idx) { midOrdered.push(...idx.map((i) => band[i])); method = 'ia'; continue; }
        }
        midOrdered.push(...band.sort((x, y) => (x.rank < 9999 && y.rank < 9999 ? x.rank - y.rank : 0)));
      }
      if (method === 'numeros') method = 'etapas';
    }
  } else method = intro.length || outro.length ? 'etapas' : 'original';
  const ordered = [...(intro.length ? [pack(intro)] : []), ...midOrdered, ...(outro.length ? [pack(outro)] : [])];
  const flat = ordered.flatMap((g) => g.ids);
  const changed = flat.some((id, i) => id !== i);
  mod.plan = {
    at: Date.now(), method, changed,
    groups: ordered.map((g) => ({ title: g.title, topic: g.topic, ids: g.ids.map((i) => frags[i].id) })),
    // fragmentos que continúan la frase del anterior: se pegan con un espacio, no con salto de párrafo
    glue: flat.filter((i, k) => k > 0 && prev.get(i) === flat[k - 1]).map((i) => frags[i].id),
  };
  mod.text = joinFrags(mod, flat.map((i) => frags[i].id));
  mod.processedAt = 0;
  save();
  return mod.plan;
}
const polishText = (t) => String(t).replace(/\blA\b/g, 'IA');
// Une fragmentos en el orden dado; los que continúan una frase se pegan con un espacio.
export function joinFrags(mod, ids) {
  const byId = new Map(mod.frags.map((f) => [f.id, f.text]));
  const glue = new Set(mod.plan?.glue || []);
  return ids.filter((id) => byId.has(id)).reduce((acc, id, k) => acc + (k ? (glue.has(id) ? ' ' : String.fromCharCode(10, 10)) : '') + polishText(byId.get(id)), '');
}

// Ordena los libros de un curso por lo que cuentan (no por cuándo se importaron).
export async function orderCourse(course, { signal, onProgress, model } = {}) {
  const mods = course.modules;
  if (mods.length < 2) return false;
  onProgress?.('Leyendo de qué trata cada libro', 0.2);
  const desc = mods.map((m) => {
    const t = m.book?.title || m.title;
    const sum = m.sheet?.summary || m.book?.preface?.[0] || m.text.slice(0, 260);
    return `${t} — ${clean(sum).slice(0, 220)}`;
  });
  const nums = mods.map((m) => explicitNumber(m.title) || explicitNumber(m.book?.title || '') || 0);
  let order;
  if (nums.every((n) => n > 0)) order = mods.map((_, i) => i).sort((a, b) => nums[a] - nums[b]);
  else {
    onProgress?.('Decidiendo el orden de estudio', 0.6);
    order = await aiOrder(desc, { signal, model }, 'libros');
  }
  if (!order) return false;
  course.modules = order.map((i) => mods[i]);
  course.modules.forEach((m, i) => { m.seq = i + 1; });
  save();
  return true;
}

/* ───────── escribir el libro ───────── */

const CHAPTER = {
  type: 'object',
  properties: { heading: str, lead: str, paragraphs: list, keyIdea: str, remember: list },
  required: ['heading', 'paragraphs'],
};
const REVISE = { type: 'object', properties: { paragraphs: list }, required: ['paragraphs'] };
const FRONT = { type: 'object', properties: { title: str, subtitle: str, preface: list }, required: ['title', 'preface'] };

function splitParts(text, size = 2300) {
  const out = [];
  let cur = '';
  for (const p of text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length > size) { out.push(cur.trim()); cur = ''; }
    cur += p + '\n\n';
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function makeBook(mod, { lang = 'es', style = 'explained', model, verify = true, onProgress, signal } = {}) {
  const explained = style === 'explained';
  const langRule = lang === 'es'
    ? 'Escribe en español neutro; si el material está en otro idioma, tradúcelo y conserva en inglés los términos técnicos.'
    : 'Mantén el idioma original del material.';

  // 1) los temas y su orden salen del contenido
  let groups;
  if (mod.frags?.length > 1) {
    if (!mod.plan) await orderModule(mod, { signal, model, onProgress: (m, p) => onProgress?.(m, p * 0.3) });
    groups = mod.plan.groups.map((g) => ({ title: g.title, text: joinFrags(mod, g.ids) }));
  } else {
    const { chunks } = chunkSections(mod.text, 2300, 14);
    if (!chunks.length) throw new Error('No hay texto para convertir.');
    groups = chunks.map((c) => ({ title: '', text: c }));
  }
  const truncatedFrom = groups.length > 14 ? groups.length : 0;
  groups = groups.slice(0, 14);

  // 2) un capítulo por tema
  const base = mod.frags?.length > 1 ? 0.3 : 0;
  const chapters = [];
  let fallbacks = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const parts = splitParts(g.text);
    const given = headingOf(g.text);
    let heading = given || g.title, lead = '', keyIdea = '';
    let capTotal = 0;
    let paragraphs = [], remember = [];
    let failed = false;
    for (let pi = 0; pi < parts.length; pi++) {
      onProgress?.(`Escribiendo el capítulo ${gi + 1} de ${groups.length}${parts.length > 1 ? ` (parte ${pi + 1})` : ''}`, base + ((gi + pi / parts.length) / groups.length) * (0.9 - base));
      let res = null;
      const hi = targetParas(parts[pi].length), lo = Math.max(1, hi - 1);
      capTotal += hi + 1;
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await chatJSON({
          signal, model, schema: CHAPTER, temperature: attempt ? 0.55 : 0.3, system: SYS,
          user: explained
            ? `Material fuente (apuntes o texto leído de capturas; puede tener errores de lectura, líneas cortadas y restos de interfaz):\n"""\n${parts[pi]}\n"""\n\nEscríbelo como ${pi ? `la continuación del capítulo «${heading}»` : 'un capítulo de libro didáctico'}, bien ordenado y explicado:\n- heading: título claro del capítulo${g.title ? ` (sugerido: «${g.title}»)` : ''}\n- lead: 1 o 2 oraciones que presentan de qué trata\n- paragraphs: de ${lo} a ${hi} párrafos que expliquen el contenido paso a paso, en orden lógico y con tus palabras. El material es ${parts[pi].length < 700 ? 'corto' : 'extenso'}: no rellenes ni repitas ideas. Define cada término al introducirlo y explica el porqué. No copies el texto tal cual ni lo dejes en lista. No numeres los párrafos. Corrige errores de lectura y ortografía.\n- keyIdea: la idea más importante en una oración\n- remember: 3 puntos breves para recordar\nUsa solo la información del material. Si el material no trae un ejemplo, no pongas ninguno; no inventes datos, cifras, personas ni casos.\n${langRule}`
            : `Texto leído de capturas o de un documento (puede tener errores de lectura, líneas cortadas y restos de interfaz):\n"""\n${parts[pi]}\n"""\n\nConviértelo en un fragmento de libro listo para leer:\n- heading: título corto\n- paragraphs: TODO el contenido reescrito en párrafos fluidos, en orden lógico. Corrige errores de lectura y ortografía, une las líneas cortadas y elimina restos de interfaz. Conserva todos los datos y definiciones.\n${langRule}`,
        });
      } catch (e) { if (e.name === 'AbortError') throw e; }
      if (polishAll(res?.paragraphs).join(' ').length >= parts[pi].length * (explained ? 0.3 : 0.4)) break;
      }
      const paras = polishAll(res?.paragraphs);
      if (paras.length && paras.join(' ').length >= parts[pi].length * (explained ? 0.3 : 0.4)) {
        if (!pi) { heading = given || polish(res.heading) || heading; lead = explained ? polish(res.lead) : ''; keyIdea = explained ? polish(res.keyIdea) : ''; }
        paragraphs.push(...paras);
        if (explained) remember.push(...polishAll(res.remember));
      } else { failed = true; paragraphs.push(...polishAll(parts[pi].split(/\n{2,}/)).filter((p) => p !== heading)); }
    }
    // 3) revisión de fidelidad: quitar lo que el material no respalda
    if (explained && verify && !failed) {
      onProgress?.(`Revisando el capítulo ${gi + 1} contra tu material`, base + ((gi + 0.9) / groups.length) * (0.9 - base));
      try {
        const rv = await chatJSON({
          signal, model, schema: REVISE, temperature: 0.1, system: SYS,
          user: `Material fuente:\n"""\n${g.text.slice(0, 2600)}\n"""\n\nBorrador del capítulo:\n${paragraphs.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nRevisa el borrador contra el material: elimina o corrige cualquier afirmación, ejemplo o cifra que NO esté respaldada por el material; corrige ortografía y puntuación; mantén el estilo claro y los mismos párrafos cuando estén bien. Devuelve paragraphs con todos los párrafos revisados.`,
        });
        const rp = polishAll(rv.paragraphs);
        if (rp.length && rp.join(' ').length >= paragraphs.join(' ').length * 0.55) paragraphs = rp;
      } catch (e) { if (e.name === 'AbortError') throw e; }
    }
    if (!failed) paragraphs = splitLong(dedupeSentences(filterUnsupported(noMeta(paragraphs), g.text))).slice(0, capTotal + 2);
    if (failed) fallbacks++;
    chapters.push({
      heading: heading || `Capítulo ${gi + 1}`, lead, paragraphs, keyIdea,
      remember: [...new Set(remember)].slice(0, 4), original: failed || undefined,
    });
  }

  // 4) portada e introducción a partir de los capítulos reales; el cierre sale de las ideas clave
  let title = '', subtitle = '', preface = [];
  if (explained) {
    onProgress?.('Escribiendo la introducción', 0.94);
    const outline = chapters.map((c, i) => `${i + 1}. ${c.heading}${c.keyIdea ? ' — ' + c.keyIdea : ''}`).join('\n').slice(0, 2800);
    try {
      const f = await chatJSON({ signal, model, schema: FRONT, system: SYS, user: `Libro de estudio basado en "${mod.title}". Capítulos, en su orden:\n${outline}\n\nEscribe:\n- title: título atractivo del libro\n- subtitle: subtítulo corto\n- preface: 2 párrafos breves de introducción (de qué trata y cómo leerlo). Menciona solo los temas de la lista de capítulos; no agregues temas, cifras ni ejemplos nuevos.\n${langRule}` });
      title = polish(f.title); subtitle = polish(f.subtitle); preface = polishAll(f.preface);
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  const takeaways = chapters.map((c) => c.keyIdea).filter(Boolean);
  mod.book = { style, lang, title: title || mod.title, subtitle, preface, chapters, takeaways, at: Date.now(), truncated: truncatedFrom, fallbacks, ordered: mod.plan ? { method: mod.plan.method, changed: mod.plan.changed } : null, model: model || null };
  save();
  logAct();
  return mod.book;
}

export function bookMarkdown(m) {
  const b = m.book;
  const part = (arr) => (arr?.length ? arr.join('\n\n') + '\n\n' : '');
  return `# ${b.title}\n\n${b.subtitle ? `*${b.subtitle}*\n\n` : ''}${b.preface?.length ? `## Introducción\n\n${part(b.preface)}` : ''}${b.chapters.map((c, i) => `## Capítulo ${i + 1}. ${c.heading}\n\n${c.lead ? `*${c.lead}*\n\n` : ''}${part(c.paragraphs)}${c.keyIdea ? `> **Idea clave:** ${c.keyIdea}\n\n` : ''}${c.remember?.length ? `**Para recordar**\n\n${c.remember.map((r) => `- ${r}`).join('\n')}\n\n` : ''}`).join('')}${b.takeaways?.length ? `## Para cerrar\n\nLo esencial, capítulo por capítulo:\n\n${b.takeaways.map((t) => `- ${t}`).join('\n')}\n` : ''}`;
}
