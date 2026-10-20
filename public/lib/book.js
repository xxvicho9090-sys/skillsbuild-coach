// Libro de estudio con IA: entiende de qué trata cada fragmento, los agrupa por tema, decide el orden
// lógico (aunque las capturas lleguen desordenadas), escribe cada capítulo y lo revisa contra tu material.
import { chatJSON } from './ollama.js';
import { chunkSections, words } from './text.js';
import { save, logAct } from './store.js';

const str = { type: 'string' };
const list = { type: 'array', items: str };
const SYS = 'Eres un autor de libros de estudio claros, ordenados y didácticos. Explicas con palabras sencillas, en prosa, y eres fiel al material: no inventas datos, cifras ni citas.';
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* ───────── lectura fácil: medir, simplificar y detectar cómo está escrito el material ───────── */

// Sílabas (aprox. para español): vocales juntas cuentan una, salvo hiatos (a-e-o entre sí o i/u tónicas).
const STRONG = 'aeoáéó', ACC_WEAK = 'íú';
function syllables(word) {
  const groups = word.toLowerCase().match(/[aeiouáéíóúü]+/g) || [];
  return Math.max(1, groups.reduce((n, g) => {
    let k = 1;
    for (let i = 1; i < g.length; i++) if ((STRONG.includes(g[i - 1]) && STRONG.includes(g[i])) || ACC_WEAK.includes(g[i - 1]) || ACC_WEAK.includes(g[i])) k++;
    return n + k;
  }, 0));
}
// Índice de Fernández Huerta (0–100; más alto = más fácil).
export function readability(text) {
  const t = String(text || '');
  const ws = t.match(/[\p{L}]+/gu) || [];
  const sents = (t.match(/[^.!?…]+[.!?…]+/g) || [t]).filter((x) => /\p{L}/u.test(x));
  if (ws.length < 8) return { score: 100, label: 'muy fácil' };
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const score = Math.max(0, Math.min(100, Math.round(206.84 - 60 * (syl / ws.length) - 1.02 * (ws.length / Math.max(1, sents.length)))));
  const label = score >= 80 ? 'muy fácil' : score >= 70 ? 'fácil' : score >= 60 ? 'normal' : score >= 50 ? 'algo difícil' : 'difícil';
  return { score, label };
}

// Simplificación sin IA: quita muletillas, cambia palabras rebuscadas por comunes y parte frases largas.
const SWAPS = [
  [/\b(es importante (destacar|mencionar|señalar|resaltar|tener en cuenta) que|cabe (destacar|mencionar|señalar|resaltar) que|vale la pena (mencionar|destacar) que)\s*/gi, ''],
  [/\ben (conclusión|resumen),\s*/gi, ''],
  [/\bcon el fin de\b/gi, 'para'], [/\ba fin de\b/gi, 'para'], [/\ben la actualidad\b/gi, 'hoy'],
  [/\bcon respecto a\b/gi, 'sobre'], [/\bdebido a que\b/gi, 'porque'], [/\bya que\b/gi, 'porque'],
  [/\bno obstante,?\s*/gi, 'pero '], [/\bsin embargo,?\s*/gi, 'pero '], [/\basimismo,?\s*/gi, 'también '],
  [/\bes por ello que\b/gi, 'por eso'], [/\bpor lo tanto,?\s*/gi, 'así '], [/\bpor consiguiente,?\s*/gi, 'así '],
  [/\btiene como objetivo\b/gi, 'busca'], [/\bllevar a cabo\b/gi, 'hacer'], [/\bcon la finalidad de\b/gi, 'para'],
  [/\bde manera (más )?(eficiente|efectiva)\b/gi, 'bien'], [/\ba través de\b/gi, 'con'],
  [/\butiliz(a|an|ar|ado|ados|ada|adas|ando|amos|ó)\b/gi, (m, e) => 'us' + e], [/\butilic(e|en)\b/gi, (m, e) => 'us' + e],
];
export function plainify(text) {
  let t = String(text || '');
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  t = t.replace(/\s{2,}/g, ' ').replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, a, c) => a + c.toUpperCase());
  // frases de más de 28 palabras: se parten en una coma o conector si ambas mitades quedan con cuerpo
  return t.split(/(?<=[.!?])\s+/).map((sent) => {
    const n = (sent.match(/\p{L}+/gu) || []).length;
    if (n <= 28) return sent;
    const re = /,\s+(?:y|pero|además)\s+|;\s+/gi;
    let best = null, m;
    while ((m = re.exec(sent))) {
      const left = (sent.slice(0, m.index).match(/\p{L}+/gu) || []).length;
      if (left >= 8 && n - left >= 8 && (!best || Math.abs(left - n / 2) < Math.abs(best.left - n / 2))) best = { left, at: m.index, len: m[0].length, conn: m[0] };
    }
    if (!best) return sent;
    const a = sent.slice(0, best.at).replace(/[,;]$/, '');
    let b = sent.slice(best.at + best.len);
    const keep = /^[,;]\s+(pero|además)/i.test(best.conn) ? best.conn.replace(/^[,;]\s+/, '').trim() + ' ' : '';
    b = keep + b;
    return `${a}. ${b.charAt(0).toUpperCase()}${b.slice(1)}`;
  }).join(' ');
}

// Cómo está escrito el material: pasos, definiciones o listas (para pedirle a la IA la forma correcta).
export function detectStructure(text) {
  const t = String(text || '');
  const lines = t.split(/\n/).map((l) => l.trim());
  const numbered = lines.filter((l) => /^(\d{1,2}[.)]|paso\s*\d+|[•\-–*])\s+\S/i.test(l)).length;
  const seq = (t.match(/\b(primero|segundo|tercero|luego|despu[eé]s|finalmente|por [uú]ltimo)\b/gi) || []).length;
  const defs = lines.filter((l) => /^[\p{Lu}][^.:\n]{1,40}:\s+\S/u.test(l)).length + (t.match(/\b(se define como|se refiere a|consiste en|es la capacidad de|es el proceso de)\b/gi) || []).length;
  return { steps: numbered >= 2 && /paso|proced|instal|configur|crear|abrir|seguir/i.test(t) || seq >= 3, defs: defs >= 2, list: numbered >= 3 };
}
// Pasos y definiciones tal como están en el material (sin IA: no se inventa nada).
export function extractSteps(text) {
  const out = [];
  for (const l of String(text).split(/\n/)) {
    const m = l.trim().match(/^(?:\d{1,2}[.)]|paso\s*\d+\s*[:.)\-–]?)\s+(.{6,})$/i);
    if (m) out.push(m[1].trim().replace(/\s+/g, ' '));
  }
  return out.length >= 2 ? out.slice(0, 10) : [];
}
export function extractTerms(text) {
  const out = [];
  for (const l of String(text).split(/\n/)) {
    const m = l.trim().match(/^(?:[•\-–*]\s*)?(\p{Lu}[^.:\n]{1,40}):\s+(.{8,})$/u);
    if (m && m[1].trim().split(/\s+/).length <= 5 && !/^\d/.test(m[1])) out.push({ term: m[1].trim(), meaning: m[2].trim().replace(/\s+/g, ' ') });
  }
  return out.length >= 2 ? out.slice(0, 8) : [];
}
const supportRatio = (sent, source) => {
  const src = new Set(words(source).map((w) => w.slice(0, 5)));
  const ws = words(sent).filter((w) => w.length >= 5);
  return ws.length < 3 ? 1 : ws.filter((w) => src.has(w.slice(0, 5))).length / ws.length;
};
const PLAIN = 'Estilo: para alguien que recién empieza. Frases cortas (máximo 20 palabras), palabras cotidianas en vez de rebuscadas, un solo tema por párrafo (2 a 4 frases), explica cada término técnico con una frase corta la primera vez, sin muletillas ("es importante destacar que", "cabe mencionar") y sin repetir ideas ni frases de relleno.';

const hashStr = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };

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
const META = /^\s*(la idea (m[aá]s )?(importante|clave|principal)|idea clave|recuerda|para recordar|puntos clave|en resumen,? (los )?puntos|key ?idea|remember|steps|terms|lead|heading|paragraphs)\s*([:：]|\b)/i;
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
    if (kept.some((k) => jaccard(k, t) >= 0.6)) return false;
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
    const sig = frags[i].text.length + ':' + frags[i].text.slice(0, 30);
    if (!frags[i].label || frags[i].labelSig !== sig) { frags[i].label = await labelUnit(frags[i], { signal, model }); frags[i].labelSig = sig; }
    labels.push(frags[i].label);
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
  // Lo que ya estaba en el libro conserva su orden relativo; las fotos nuevas se acomodan donde corresponde.
  if (frags.some((f) => f.prior) && frags.some((f) => !f.prior)) {
    const slots = flat.map((id, k) => (frags[id].prior ? k : -1)).filter((k) => k >= 0);
    const priorSorted = flat.filter((id) => frags[id].prior).sort((a, b) => frags[a].pos - frags[b].pos);
    slots.forEach((k, j) => { flat[k] = priorSorted[j]; });
    let cur = 0;
    ordered.forEach((g) => { g.ids = flat.slice(cur, cur + g.ids.length); cur += g.ids.length; });
  }
  const changed = flat.some((id, i) => id !== i);
  mod.plan = {
    at: Date.now(), method, changed,
    groups: ordered.map((g) => ({ title: g.title, topic: g.topic, ids: g.ids.map((i) => frags[i].id) })),
    // fragmentos que continúan la frase del anterior: se pegan con un espacio, no con salto de párrafo
    glue: flat.filter((i, k) => k > 0 && prev.get(i) === flat[k - 1]).map((i) => frags[i].id),
  };
  mod.text = joinFrags(mod, flat.map((i) => frags[i].id));
  mod.processedAt = 0;
  frags.forEach((f) => { delete f.prior; delete f.pos; });
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
  properties: { heading: str, lead: str, paragraphs: list, keyIdea: str, remember: list, steps: list, terms: { type: 'array', items: { type: 'object', properties: { term: str, meaning: str }, required: ['term', 'meaning'] } } },
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

export async function makeBook(mod, { lang = 'es', style = 'explained', level = 'simple', model, verify = true, onProgress, signal } = {}) {
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
  const cacheNew = {};
  let fallbacks = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    // si este tema no cambió desde la última vez, se reutiliza el capítulo ya escrito
    const ckey = hashStr([style, lang, level, verify ? 1 : 0, model || '', g.text].join('|'));
    if (mod.cache?.[ckey]) { chapters.push(mod.cache[ckey]); cacheNew[ckey] = mod.cache[ckey]; onProgress?.(`Capítulo ${gi + 1} sin cambios`, base + ((gi + 1) / groups.length) * (0.9 - base)); continue; }
    const parts = splitParts(g.text);
    const given = headingOf(g.text);
    let heading = given || g.title, lead = '', keyIdea = '';
    let capTotal = 0;
    let paragraphs = [], remember = [], steps = [], terms = [];
    let failed = false;
    for (let pi = 0; pi < parts.length; pi++) {
      onProgress?.(`Escribiendo el capítulo ${gi + 1} de ${groups.length}${parts.length > 1 ? ` (parte ${pi + 1})` : ''}`, base + ((gi + pi / parts.length) / groups.length) * (0.9 - base));
      let res = null;
      const hi = targetParas(parts[pi].length), lo = Math.max(1, hi - 1);
      capTotal += hi + 1;
      const st = detectStructure(parts[pi]);
      const struct = (st.steps ? '\n- steps: el procedimiento del material como pasos cortos, cada uno empezando con un verbo (si no hay procedimiento, deja la lista vacía)' : '') + (st.defs ? '\n- terms: los términos que el material define, cada uno con term y meaning (una frase corta)' : '');
      const plain = level === 'simple' ? PLAIN + '\n' : '';
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await chatJSON({
          signal, model, schema: CHAPTER, temperature: attempt ? 0.55 : 0.3, system: SYS,
          user: explained
            ? `Material fuente (apuntes o texto leído de capturas; puede tener errores de lectura, líneas cortadas y restos de interfaz):\n"""\n${parts[pi]}\n"""\n\nEscríbelo como ${pi ? `la continuación del capítulo «${heading}»` : 'un capítulo de libro didáctico'}, bien ordenado y explicado:\n- heading: título claro del capítulo${g.title ? ` (sugerido: «${g.title}»)` : ''}\n- lead: 1 o 2 oraciones que presentan de qué trata\n- paragraphs: de ${lo} a ${hi} párrafos que expliquen el contenido paso a paso, en orden lógico y con tus palabras. El material es ${parts[pi].length < 700 ? 'corto' : 'extenso'}: no rellenes ni repitas ideas. Define cada término al introducirlo y explica el porqué. No copies el texto tal cual ni lo dejes en lista. No numeres los párrafos. Corrige errores de lectura y ortografía.\n- keyIdea: la idea más importante en una oración\n- remember: 3 puntos breves para recordar${struct}\n${plain}Usa solo la información del material. Si el material no trae un ejemplo, no pongas ninguno; no inventes datos, cifras, personas ni casos.\n${langRule}`
            : `Texto leído de capturas o de un documento (puede tener errores de lectura, líneas cortadas y restos de interfaz):\n"""\n${parts[pi]}\n"""\n\nConviértelo en un fragmento de libro listo para leer:\n- heading: título corto\n- paragraphs: TODO el contenido reescrito en párrafos fluidos, en orden lógico. Corrige errores de lectura y ortografía, une las líneas cortadas y elimina restos de interfaz. Conserva todos los datos y definiciones.\n${langRule}`,
        });
      } catch (e) { if (e.name === 'AbortError') throw e; }
      if (polishAll(res?.paragraphs).join(' ').length >= parts[pi].length * (explained ? 0.3 : 0.4)) break;
      }
      const paras = polishAll(res?.paragraphs);
      if (paras.length && paras.join(' ').length >= parts[pi].length * (explained ? 0.3 : 0.4)) {
        if (!pi) { heading = given || polish(res.heading) || heading; lead = explained ? polish(res.lead) : ''; keyIdea = explained ? polish(res.keyIdea) : ''; }
        paragraphs.push(...paras);
        if (explained) {
          remember.push(...polishAll(res.remember));
          steps.push(...polishAll(res.steps).filter((x) => supportRatio(x, parts[pi]) >= 0.4));
          terms.push(...(res.terms || []).map((t) => ({ term: polish(t.term), meaning: polish(t.meaning) })).filter((t) => t.term && t.meaning && (parts[pi].toLowerCase().includes(t.term.toLowerCase()) || supportRatio(t.term + ' ' + t.meaning, parts[pi]) >= 0.5)));
        }
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
    // el título no se repite dentro del primer párrafo
    if (heading) paragraphs = paragraphs.map((x, i) => (i === 0 && x.toLowerCase().startsWith(heading.toLowerCase()) ? x.slice(heading.length).replace(/^[\s:.\-–—]+/, '') : x)).filter((x) => x.length > 1);
    if (!failed && level === 'simple') {
      paragraphs = splitLong(paragraphs.map(plainify));
      const before = readability(paragraphs.join(' '));
      if (before.score < 58 && paragraphs.join(' ').length > 500) {
        onProgress?.(`Haciendo más sencillo el capítulo ${gi + 1}`, base + ((gi + 0.95) / groups.length) * (0.9 - base));
        try {
          const sv = await chatJSON({
            signal, model, schema: REVISE, temperature: 0.2, system: SYS,
            user: `Párrafos de un libro de estudio:\n${paragraphs.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nReescríbelos en lenguaje sencillo, para alguien que recién empieza: frases de máximo 18 palabras, palabras cotidianas, un tema por párrafo. Conserva exactamente los mismos datos y términos técnicos (explicando cada término con una frase corta la primera vez). No agregues información nueva. Devuelve paragraphs con todos los párrafos.`,
          });
          const sp = splitLong(polishAll(sv.paragraphs).map(plainify));
          if (sp.length && sp.join(' ').length >= paragraphs.join(' ').length * 0.6 && readability(sp.join(' ')).score > before.score) paragraphs = dedupeSentences(sp).slice(0, capTotal + 1);
        } catch (e) { if (e.name === 'AbortError') throw e; }
      }
    }
    if (failed) fallbacks++;
    const dSteps = extractSteps(g.text), dTerms = extractTerms(g.text);
    if (dSteps.length) steps = dSteps;
    if (dTerms.length) terms = dTerms;
    const uniq = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x).toLowerCase(); return k && !seen.has(k) && seen.add(k); }); };
    const chapterObj = {
      heading: heading || `Capítulo ${gi + 1}`, lead, paragraphs, keyIdea,
      remember: [...new Set(remember)].slice(0, 4), original: failed || undefined,
      steps: uniq(steps, (x) => x).slice(0, 8), terms: uniq(terms, (t) => t.term).slice(0, 6),
      score: readability(paragraphs.join(' ')).score,
    };
    chapters.push(chapterObj);
    if (!failed) cacheNew[ckey] = chapterObj;
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
  mod.cache = cacheNew;
  const allText = chapters.flatMap((c) => c.paragraphs).join(' ');
  mod.book = { level, readability: readability(allText), style, lang, title: title || mod.title, subtitle, preface, chapters, takeaways, at: Date.now(), truncated: truncatedFrom, fallbacks, ordered: mod.plan ? { method: mod.plan.method, changed: mod.plan.changed } : null, model: model || null };
  save();
  logAct();
  return mod.book;
}

export function bookMarkdown(m) {
  const b = m.book;
  const part = (arr) => (arr?.length ? arr.join('\n\n') + '\n\n' : '');
  return `# ${b.title}\n\n${b.subtitle ? `*${b.subtitle}*\n\n` : ''}${b.preface?.length ? `## Introducción\n\n${part(b.preface)}` : ''}${b.chapters.map((c, i) => `## Capítulo ${i + 1}. ${c.heading}\n\n${c.lead ? `*${c.lead}*\n\n` : ''}${part(c.paragraphs)}${c.terms?.length ? c.terms.map((t) => `- **${t.term}**: ${t.meaning}`).join('\n') + '\n\n' : ''}${c.steps?.length ? '**Paso a paso**\n\n' + c.steps.map((x, i) => `${i + 1}. ${x}`).join('\n') + '\n\n' : ''}${c.keyIdea ? `> **Idea clave:** ${c.keyIdea}\n\n` : ''}${c.remember?.length ? `**Para recordar**\n\n${c.remember.map((r) => `- ${r}`).join('\n')}\n\n` : ''}`).join('')}${b.takeaways?.length ? `## Para cerrar\n\nLo esencial, capítulo por capítulo:\n\n${b.takeaways.map((t) => `- ${t}`).join('\n')}\n` : ''}`;
}
