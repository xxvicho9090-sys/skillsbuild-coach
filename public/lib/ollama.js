// Cliente mínimo de Ollama. El POST va como text/plain para evitar el preflight de CORS
// (Ollama lee el cuerpo como JSON igualmente).
import { S, save } from './store.js';

export const status = { checked: false, ok: false, kind: '', models: [], error: '' };
export const PREFERRED = ['qwen2.5:3b', 'llama3.2:3b', 'qwen2.5:1.5b', 'gemma2:2b', 'llama3.2:1b', 'phi3:mini'];

export class OllamaError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const base = () => S.settings.url.trim().replace(/\/+$/, '');

async function http(path, init) {
  try {
    return await fetch(base() + path, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // ¿Ollama está corriendo pero bloquea este origen (CORS), o no responde?
    let running = false;
    try { await fetch(base() + '/api/version', { mode: 'no-cors', signal: AbortSignal.timeout(2500) }); running = true; } catch { /* no responde */ }
    throw new OllamaError(running ? 'origin' : 'down', running ? 'Ollama está activo pero no permite esta web.' : 'No se pudo conectar con Ollama.');
  }
}

async function failure(res) {
  let msg = '';
  try { msg = (await res.json()).error || ''; } catch { /* sin cuerpo */ }
  if (res.status === 403) return new OllamaError('origin', 'Ollama rechazó el origen de esta web (OLLAMA_ORIGINS).');
  if (res.status === 404 || /not found/i.test(msg)) return new OllamaError('model', `El modelo "${S.settings.model}" no está instalado.`);
  return new OllamaError('http', msg || `Ollama respondió ${res.status}.`);
}

export async function refresh() {
  try {
    const res = await http('/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw await failure(res);
    const models = ((await res.json()).models || []).map((m) => ({ name: m.name, size: m.size || 0 }));
    Object.assign(status, { checked: true, ok: true, kind: '', models, error: '' });
    if (!models.some((m) => m.name === S.settings.model)) {
      const pick = PREFERRED.map((p) => models.find((m) => m.name === p)).find(Boolean)
        || [...models].sort((a, b) => a.size - b.size)[0];
      S.settings.model = pick ? pick.name : '';
      save();
    }
  } catch (e) {
    Object.assign(status, { checked: true, ok: false, kind: e.kind || 'down', models: [], error: e.message });
  }
  return status;
}

export const ready = () => status.ok && !!S.settings.model;

// schema: JSON schema → salida estructurada. onToken: respuesta en streaming.
export async function chat({ system, user, schema, onToken, signal, temperature }) {
  if (!S.settings.model) throw new OllamaError('model', 'Elige un modelo en Ajustes.');
  const body = {
    model: S.settings.model,
    stream: !!onToken,
    keep_alive: '30m',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    options: { num_ctx: S.settings.ctx, temperature: temperature ?? (schema ? 0.2 : 0.5) },
  };
  if (schema) body.format = schema;
  const res = await http('/api/chat', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await failure(res);
  if (!onToken) return (await res.json()).message?.content ?? '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) throw new OllamaError('http', j.error);
        const t = j.message?.content || '';
        if (t) { full += t; onToken(t, full); }
      } catch (e) { if (e instanceof OllamaError) throw e; }
    }
  }
  return full;
}

export function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* intenta rescatar */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* nada */ } }
  throw new OllamaError('json', 'El modelo devolvió una respuesta que no se pudo leer.');
}

// Pide JSON y reintenta una vez si el modelo se equivoca.
export async function chatJSON(opts) {
  let last;
  for (let i = 0; i < 2; i++) {
    try { return parseJSON(await chat({ ...opts, temperature: i ? 0.5 : 0.2 })); }
    catch (e) { if (e.name === 'AbortError' || e.kind !== 'json') throw e; last = e; }
  }
  throw last;
}

export function friendly(e) {
  if (e?.name === 'AbortError') return 'Cancelado.';
  if (e instanceof OllamaError) return e.message;
  return e?.message || 'Ocurrió un error inesperado.';
}
