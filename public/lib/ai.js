// Tareas de IA sobre los apuntes. Los prompts están pensados para modelos chicos (≈2 GB):
// trozos cortos, una sola tarea por llamada y salida estructurada.
import { chat, chatJSON } from './ollama.js';
import { chunkSections, topChunks } from './text.js';
import { S, save, uid, logAct } from './store.js';

const SYS = 'Eres un tutor que ayuda a un estudiante hispanohablante con un curso de IBM SkillsBuild. ' +
  'Escribe SIEMPRE en español neutro, aunque el texto esté en inglés, y conserva en inglés los términos técnicos. ' +
  'Usa solo la información del texto entregado; no inventes datos.';

const str = { type: 'string' };
const list = { type: 'array', items: str };
const DIGEST = {
  type: 'object',
  properties: {
    heading: str,
    points: list,
    concepts: { type: 'array', items: { type: 'object', properties: { term: str, es: str, definition: str }, required: ['term', 'definition'] } },
    questions: { type: 'array', items: { type: 'object', properties: { q: str, options: list, answer: { type: 'integer' }, why: str }, required: ['q', 'options', 'answer'] } },
  },
  required: ['heading', 'points', 'concepts', 'questions'],
};
const QUESTIONS = { type: 'object', properties: { questions: DIGEST.properties.questions }, required: ['questions'] };
const SUMMARY = { type: 'object', properties: { summary: str }, required: ['summary'] };
const FEYNMAN = {
  type: 'object',
  properties: { score: { type: 'integer' }, correct: list, missing: list, errors: list, tip: str },
  required: ['score', 'correct', 'missing', 'errors', 'tip'],
};
const PROJECT = {
  type: 'object',
  properties: { title: str, objective: str, steps: list, deliverable: str },
  required: ['title', 'objective', 'steps', 'deliverable'],
};

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Los modelos chicos suelen escribir "B) opción": se quita la letra porque las opciones se mezclan.
const stripOpt = (s) => clean(s).replace(/^[([]?[A-Da-d][)\].:-]\s+/, '');

// Valida una pregunta del modelo y mezcla las opciones (los modelos chicos casi siempre ponen la correcta primero).
export function normalizeQuestion(q) {
  if (!q || !Array.isArray(q.options)) return null;
  const text = clean(q.q);
  const correct = stripOpt(q.options[Number(q.answer)]);
  if (!text || !correct) return null;
  const others = [...new Set(q.options.map(stripOpt).filter((o) => o && o !== correct))].slice(0, 3);
  if (others.length < 2) return null;
  const options = shuffle([correct, ...others]);
  return { q: text, options, answer: options.indexOf(correct), why: clean(q.why) };
}

export function dedupeConcepts(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const term = clean(c?.term), definition = clean(c?.definition);
    if (!term || !definition || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const es = clean(c.es);
    out.push({ term, es: es && es.toLowerCase() !== term.toLowerCase() ? es : '', definition });
  }
  return out;
}

export function addCards(course, mod, items) {
  let added = 0;
  for (const it of items) {
    if (!it.front || !it.back) continue;
    if (S.cards.some((c) => c.mid === mod.id && c.front === it.front)) continue;
    S.cards.push({ id: uid(), cid: course.id, mid: mod.id, front: it.front, back: it.back, due: Date.now(), step: 0, created: Date.now() });
    added++;
  }
  save();
  return added;
}

export const conceptCards = (c) => ({ front: `¿Qué es ${c.term}${c.es ? ` (${c.es})` : ''}?`, back: c.definition });

// Ordena un módulo: ficha de estudio + conceptos + preguntas + tarjetas.
export async function processModule(course, mod, { onProgress, signal } = {}) {
  const { chunks, truncated, total } = chunkSections(mod.text);
  if (!chunks.length) throw new Error('Este módulo no tiene texto para ordenar.');
  const sections = [], concepts = [], questions = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Parte ${i + 1} de ${chunks.length}`, i / (chunks.length + 1));
    const r = await chatJSON({
      signal, schema: DIGEST, system: SYS,
      user: `Texto:\n"""\n${chunks[i]}\n"""\n\nOrdénalo así:\n- heading: título corto del tema (máximo 8 palabras)\n- points: de 3 a 6 ideas clave, en frases cortas y claras\n- concepts: de 2 a 5 términos técnicos o ideas centrales (no frases largas); cada uno con term (como aparece en el texto), es (traducción al español del término, igual si ya está en español) y definition (máximo 25 palabras)\n- questions: 2 preguntas de opción múltiple con exactamente 4 opciones; answer es el índice (0 a 3) de la correcta; why explica brevemente`,
    });
    const points = (r.points || []).map(clean).filter(Boolean);
    if (points.length) sections.push({ heading: clean(r.heading) || `Parte ${i + 1}`, points });
    concepts.push(...(r.concepts || []));
    questions.push(...(r.questions || []).map(normalizeQuestion).filter(Boolean));
  }
  onProgress?.('Escribiendo el resumen', chunks.length / (chunks.length + 1));
  let summary = '';
  try {
    const digest = sections.map((s) => `${s.heading}: ${s.points.slice(0, 3).join('; ')}`).join('\n').slice(0, 3200);
    summary = clean((await chatJSON({ signal, schema: SUMMARY, system: SYS, user: `Apuntes del módulo "${mod.title}":\n${digest}\n\nEscribe un resumen de 3 a 4 oraciones usando solo estas ideas, sin agregar nada nuevo.` })).summary);
  } catch (e) { if (e.name === 'AbortError') throw e; }
  mod.sheet = { summary, sections, truncated: truncated ? total : 0 };
  mod.concepts = dedupeConcepts(concepts);
  const seenQ = new Set();
  mod.questions = questions.filter((q) => !seenQ.has(q.q.toLowerCase()) && seenQ.add(q.q.toLowerCase()));
  mod.processedAt = Date.now();
  const cards = addCards(course, mod, mod.concepts.map(conceptCards));
  save();
  logAct();
  return { cards, truncated: truncated ? total : 0 };
}

export async function moreQuestions(mod, n = 4, signal) {
  const { chunks } = chunkSections(mod.text);
  const pick = shuffle([...chunks]).slice(0, 2);
  const out = [];
  for (const c of pick) {
    const r = await chatJSON({
      signal, schema: QUESTIONS, system: SYS,
      user: `Texto:\n"""\n${c}\n"""\n\nCrea ${Math.ceil(n / pick.length)} preguntas de opción múltiple sobre lo más importante. Cada una con exactamente 4 opciones distintas y plausibles; answer es el índice (0 a 3) de la correcta; why explica brevemente. Evalúa comprensión, no memoria literal.`,
    });
    out.push(...(r.questions || []).map(normalizeQuestion).filter(Boolean));
  }
  const have = new Set(mod.questions.map((q) => q.q.toLowerCase()));
  const fresh = out.filter((q) => !have.has(q.q.toLowerCase()));
  mod.questions.push(...fresh);
  save();
  return fresh.length;
}

export async function evaluateFeynman(mod, explanation, signal) {
  const ref = mod.concepts.length
    ? mod.concepts.map((c) => `- ${c.term}: ${c.definition}`).join('\n')
    : mod.text.slice(0, 2500);
  const r = await chatJSON({
    signal, schema: FEYNMAN, system: SYS,
    user: `Tema: ${mod.title}\n\nReferencia:\n${ref}\n\nExplicación del estudiante:\n"""\n${explanation}\n"""\n\nCompárala con la referencia. Devuelve score (0 a 10), correct (qué explicó bien, máximo 3 puntos cortos), missing (qué ideas importantes faltan, máximo 3), errors (errores o imprecisiones; lista vacía si no hay) y tip (un consejo breve y amable para mejorarla).`,
  });
  return {
    score: Math.max(0, Math.min(10, Math.round(Number(r.score) || 0))),
    correct: (r.correct || []).map(clean).filter(Boolean),
    missing: (r.missing || []).map(clean).filter(Boolean),
    errors: (r.errors || []).map(clean).filter(Boolean),
    tip: clean(r.tip),
  };
}

export function askTutor(mod, question, onToken, signal) {
  const { chunks } = chunkSections(mod.text, 1800, 40);
  const ctx = topChunks(chunks, question, 2).join('\n---\n');
  return chat({
    signal, onToken, temperature: 0.3,
    system: SYS + ' Responde la duda con claridad en un máximo de 6 oraciones. Si la respuesta no está en el fragmento, dilo con honestidad.',
    user: `Fragmentos de los apuntes:\n"""\n${ctx}\n"""\n\nDuda del estudiante: ${question}`,
  });
}

export async function makeProject(course, mod, signal) {
  const ref = mod.concepts.length ? mod.concepts.map((c) => c.term).join(', ') : mod.text.slice(0, 1200);
  const r = await chatJSON({
    signal, schema: PROJECT, system: SYS,
    user: `Curso: ${course.name}\nMódulo: ${mod.title}\nConceptos: ${ref}\n\nPropón un mini proyecto práctico (1 a 2 horas) para aplicar lo aprendido y poder mostrarlo en un portafolio. Devuelve title, objective (1 oración), steps (4 a 6 pasos concretos) y deliverable (qué se entrega al final).`,
  });
  return `${clean(r.title)}\n\nObjetivo: ${clean(r.objective)}\n\nPasos:\n${(r.steps || []).map((s, i) => `${i + 1}. ${clean(s)}`).join('\n')}\n\nEntregable: ${clean(r.deliverable)}`;
}

// ───────── Libro ─────────
const CHAPTER = {
  type: 'object',
  properties: { heading: str, lead: str, paragraphs: list, keyIdea: str, remember: list },
  required: ['heading', 'paragraphs'],
};
const FRONT = { type: 'object', properties: { title: str, subtitle: str, preface: list }, required: ['title', 'preface'] };
const EDITOR = 'Eres un autor de libros de estudio claros, ordenados y didácticos. Explicas con palabras sencillas, en prosa, y eres fiel al material: no inventas datos, cifras ni citas.';

const outlineHead = (src) => { const f = src.split('\n')[0].trim(); return f.length <= 70 && !/[.!?:]$/.test(f) ? f : ''; };

// Convierte el texto (capturas, PDF, apuntes) en un libro con portada, introducción, capítulos y cierre.
// style 'explained': capítulos explicados con ejemplo, idea clave y puntos para recordar.
// style 'faithful': solo limpia, ordena y redacta en párrafos, sin agregar explicaciones.
// Si el modelo acorta de más un trozo, se conserva el texto original de ese trozo: nunca se pierde contenido.
export async function makeBook(mod, { lang = 'es', style = 'explained', onProgress, signal } = {}) {
  const { chunks, truncated, total } = chunkSections(mod.text, 2200, 14);
  if (!chunks.length) throw new Error('No hay texto para convertir.');
  const langRule = lang === 'es'
    ? 'Escribe en español neutro; si el material está en otro idioma, tradúcelo y conserva en inglés los términos técnicos.'
    : 'Mantén el idioma original del material.';
  const explained = style === 'explained';
  const steps = chunks.length + (explained ? 1 : 0);
  const chapters = [];
  let fallbacks = 0;
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Escribiendo el capítulo ${i + 1} de ${chunks.length}`, i / steps);
    const src = chunks[i];
    let res = null;
    try {
      res = await chatJSON({
        signal, schema: CHAPTER, temperature: 0.3, system: EDITOR,
        user: explained
          ? `Material fuente (apuntes o texto leído de capturas; puede tener errores de lectura, líneas cortadas y restos de interfaz):\n"""\n${src}\n"""\n\nEscríbelo como un capítulo de libro didáctico, bien ordenado y explicado:\n- heading: título claro del capítulo\n- lead: 1 o 2 oraciones que presentan de qué trata\n- paragraphs: de 3 a 6 párrafos que expliquen el contenido paso a paso, en orden lógico y con tus palabras. Define cada término al introducirlo, explica el porqué y, si ayuda, agrega un ejemplo simple. No copies el texto tal cual ni lo dejes en lista. Corrige errores de lectura.\n- keyIdea: la idea más importante del capítulo en una oración\n- remember: 3 puntos breves para recordar\nUsa solo la información del material.\n${langRule}`
          : `Texto leído de capturas o de un documento (puede tener errores de lectura, líneas cortadas y restos de interfaz):\n"""\n${src}\n"""\n\nConviértelo en un fragmento de libro listo para leer:\n- heading: título corto\n- paragraphs: TODO el contenido reescrito en párrafos fluidos, en orden lógico. Corrige errores de lectura y ortografía, une las líneas cortadas y elimina restos de interfaz (botones, menús, números de página). Conserva todos los datos y definiciones.\n${langRule}`,
      });
    } catch (e) { if (e.name === 'AbortError') throw e; }
    const paras = (res?.paragraphs || []).map(clean).filter((p) => p.length > 1);
    const outLen = paras.join(' ').length;
    if (paras.length && outLen >= src.length * (explained ? 0.3 : 0.4)) {
      chapters.push({
        heading: clean(res.heading) || outlineHead(src) || `Capítulo ${i + 1}`,
        lead: explained ? clean(res.lead) : '', paragraphs: paras,
        keyIdea: explained ? clean(res.keyIdea) : '', remember: explained ? (res.remember || []).map(clean).filter(Boolean).slice(0, 4) : [],
      });
    } else {
      fallbacks++;
      chapters.push({ heading: clean(res?.heading) || outlineHead(src) || `Capítulo ${i + 1}`, lead: '', paragraphs: src.split(/\n{2,}/).map(clean).filter(Boolean), keyIdea: '', remember: [], original: true });
    }
  }
  let title = '', subtitle = '', preface = [];
  const takeaways = chapters.map((c) => c.keyIdea).filter(Boolean); // el cierre sale de las ideas clave reales, sin inventar con el modelo
  if (explained) {
    const outline = chapters.map((c, i) => `${i + 1}. ${c.heading}${c.keyIdea ? ' — ' + c.keyIdea : ''}`).join('\n').slice(0, 2800);
    try {
      onProgress?.('Escribiendo la introducción', chunks.length / steps);
      const f = await chatJSON({ signal, schema: FRONT, system: EDITOR, user: `Libro de estudio basado en "${mod.title}". Capítulos:\n${outline}\n\nEscribe:\n- title: título atractivo del libro\n- subtitle: subtítulo corto\n- preface: 2 párrafos de introducción (de qué trata, qué se aprenderá y cómo leerlo). Usa solo lo que dicen los capítulos.\n${langRule}` });
      title = clean(f.title); subtitle = clean(f.subtitle); preface = (f.preface || []).map(clean).filter(Boolean);
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  mod.book = { style, lang, title: title || mod.title, subtitle, preface, chapters, takeaways, at: Date.now(), truncated: truncated ? total : 0, fallbacks };
  save();
  logAct();
  return mod.book;
}

export function bookMarkdown(m) {
  const b = m.book;
  const part = (arr) => (arr?.length ? arr.join('\n\n') + '\n\n' : '');
  return `# ${b.title}\n\n${b.subtitle ? `*${b.subtitle}*\n\n` : ''}${b.preface?.length ? `## Introducción\n\n${part(b.preface)}` : ''}${b.chapters.map((c, i) => `## Capítulo ${i + 1}. ${c.heading}\n\n${c.lead ? `*${c.lead}*\n\n` : ''}${part(c.paragraphs)}${c.keyIdea ? `> **Idea clave:** ${c.keyIdea}\n\n` : ''}${c.remember?.length ? `**Para recordar**\n\n${c.remember.map((r) => `- ${r}`).join('\n')}\n\n` : ''}`).join('')}${b.takeaways?.length ? `## Para cerrar\n\nLo esencial, capítulo por capítulo:\n\n${b.takeaways.map((t) => `- ${t}`).join('\n')}\n` : ''}`;
}
