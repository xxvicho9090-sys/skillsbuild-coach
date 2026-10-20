// Limpieza y estructura de texto, todo sin IA (funciona aunque Ollama esté apagado).

export function cleanText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[​‌‍﻿­]/g, '')
    .replace(/ /g, ' ')
    .replace(/\t/g, ' ')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isBullet = (l) => /^\s*([•·▪◦●○■□\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+/.test(l);

// Une las líneas cortadas de un PDF en párrafos.
export function reflow(lines) {
  const out = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) { out.push(cur); cur = ''; } continue; }
    if (!cur) { cur = line; continue; }
    if (isBullet(line)) { cur += '\n' + line; continue; }
    if (/[-‐]$/.test(cur) && /^\p{Ll}/u.test(line)) { cur = cur.slice(0, -1) + line; continue; }
    const last = cur.split('\n').pop();
    if (last.length >= 60) { cur += ' ' + line; continue; }
    out.push(cur);
    cur = line;
  }
  if (cur) out.push(cur);
  return out.join('\n\n');
}

// Párrafos de una sola línea, cortos y sin punto final → títulos de sección.
const isHeading = (p, next) =>
  !p.includes('\n') && p.length >= 3 && p.length <= 90 && !/[.,;:!?]$/.test(p) && !/^\d+$/.test(p) && !!next && next.length > p.length;

export function outline(text) {
  const paras = cleanText(text).split(/\n{2,}/).filter(Boolean);
  const sections = [];
  let cur = { heading: '', body: [] };
  paras.forEach((p, i) => {
    if (isHeading(p, paras[i + 1])) {
      if (cur.heading || cur.body.length) sections.push(cur);
      cur = { heading: p, body: [] };
    } else cur.body.push(p);
  });
  if (cur.heading || cur.body.length) sections.push(cur);
  return sections.map((s) => ({ heading: s.heading, body: s.body.join('\n\n') }));
}

// Trozos de ~size caracteres respetando las secciones; los párrafos largos se cortan por oraciones.
export function chunkSections(text, size = 2600, max = 10) {
  const pieces = [];
  for (const s of outline(text)) {
    const full = (s.heading ? s.heading + '\n' : '') + s.body;
    if (full.length <= size) { pieces.push(full); continue; }
    let cur = s.heading ? s.heading + '\n' : '';
    for (const para of s.body.split(/\n{2,}/)) {
      const parts = para.length > size ? para.match(new RegExp(`[\\s\\S]{1,${size}}(?:[.!?]\\s|$)`, 'g')) || [para] : [para];
      for (const part of parts) {
        if (cur.length + part.length > size && cur.trim()) { pieces.push(cur.trim()); cur = ''; }
        cur += part + '\n\n';
      }
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  const chunks = [];
  let acc = '';
  for (const p of pieces) {
    if (acc && acc.length + p.length > size) { chunks.push(acc.trim()); acc = ''; }
    acc += p + '\n\n';
  }
  if (acc.trim()) chunks.push(acc.trim());
  return { chunks: chunks.slice(0, max), truncated: chunks.length > max, total: chunks.length };
}

const STOP = new Set('de la que el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros the of and to in is that for it as with was on are by this be or from at an'.split(' '));
export const words = (s) => (String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]{3,}/g) || []).filter((w) => !STOP.has(w));

// Los fragmentos que más se parecen a la pregunta.
export function topChunks(chunks, query, n = 2) {
  const q = new Set(words(query));
  return chunks
    .map((c) => ({ c, s: words(c).reduce((a, w) => a + (q.has(w) ? 1 : 0), 0) / Math.sqrt(c.length) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.c);
}

// ¿Qué conceptos del módulo mencionó el estudiante en su explicación?
export function coverage(concepts, explanation) {
  const ex = new Set(words(explanation));
  const raw = explanation.toLowerCase();
  return concepts.map((c) => {
    const terms = [c.term, c.es].filter(Boolean);
    const hit = terms.some((t) => {
      if (raw.includes(t.toLowerCase())) return true;
      const ws = words(t);
      return ws.length > 0 && ws.filter((w) => ex.has(w)).length / ws.length >= 0.6;
    });
    return { ...c, hit };
  });
}

export const wordCount = (s) => (String(s).match(/\S+/g) || []).length;
