// OCR local (Tesseract en WebAssembly, español + inglés). Todo está en /vendor/ocr: no usa internet.
import { cleanText, reflow } from './text.js';

const BASE = new URL('../vendor/ocr/', import.meta.url).href;
let workerPromise = null;
let onProgress = null;

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => fail(new Error('No se pudo cargar el lector de imágenes (OCR).'));
    document.head.append(s);
  });
}

async function getWorker() {
  workerPromise ||= (async () => {
    if (!window.Tesseract) await loadScript(BASE + 'tesseract.min.js');
    return window.Tesseract.createWorker(['spa', 'eng'], 1, {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE,
      langPath: BASE,
      gzip: false,
      logger: (m) => onProgress?.(m),
    });
  })().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

// Capturas pequeñas se agrandan y las de tema oscuro se invierten: Tesseract lee mejor texto negro sobre blanco.
async function prepare(source) {
  const bmp = source instanceof Blob ? await createImageBitmap(source) : source;
  const w = bmp.width, h = bmp.height;
  const scale = Math.max(w, h) < 1600 ? Math.min(2, 1600 / Math.max(w, h)) : Math.max(w, h) > 3200 ? 3200 / Math.max(w, h) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 97) { sum += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11; n++; }
  if (sum / n < 110) {
    const d = document.createElement('canvas');
    d.width = c.width; d.height = c.height;
    const dc = d.getContext('2d');
    dc.filter = 'grayscale(1) invert(1)';
    dc.drawImage(c, 0, 0);
    return d;
  }
  return c;
}

// source: Blob/File de imagen o canvas. progress(0..1, mensaje)
export async function recognize(source, progress) {
  onProgress = (m) => {
    if (m.status === 'recognizing text') progress?.(m.progress, 'Leyendo texto');
    else if (m.status) progress?.(0, m.status.includes('load') || m.status.includes('init') ? 'Preparando el lector' : m.status);
  };
  const worker = await getWorker();
  const canvas = await prepare(source);
  const { data } = await worker.recognize(canvas);
  return cleanText(reflow(data.text.split('\n'))).replace(/\blA\b/g, 'IA'); // el OCR confunde "IA" con "lA"
}

export async function stopOCR() {
  const p = workerPromise;
  workerPromise = null;
  try { await (await p)?.terminate(); } catch { /* ya cerrado */ }
}
