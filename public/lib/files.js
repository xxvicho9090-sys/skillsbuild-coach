// Lectura de PDF, Word y texto en el navegador. Nada se sube a ningún servidor.
import { cleanText, reflow } from './text.js';
import { recognize } from './ocr.js';

let pdfjs;
async function loadPdf() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = new URL(src, import.meta.url).href;
    s.onload = ok;
    s.onerror = () => fail(new Error('No se pudo cargar el lector de Word.'));
    document.head.append(s);
  });
}

const pageNo = /^(p[aá]g(ina)?\.?|page)?\s*\d{1,4}(\s*(de|of|\/)\s*\d{1,4})?$/i;

async function readPdf(file, onProgress) {
  const lib = await loadPdf();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageLines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    let line = '', lastY = null, lastEnd = 0;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5], x = it.transform[4];
      const size = Math.abs(it.transform[3]) || 10;
      if (lastY !== null && Math.abs(y - lastY) > size * 0.5) { lines.push(line); line = ''; lastEnd = 0; }
      if (line && x - lastEnd > size * 0.15 && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
      line += it.str;
      lastY = y;
      lastEnd = x + (it.width || 0);
      if (it.hasEOL) { lines.push(line); line = ''; lastY = null; lastEnd = 0; }
    }
    if (line) lines.push(line);
    pageLines.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
    onProgress?.(p, doc.numPages);
  }
  // Encabezados y pies repetidos en muchas páginas + números de página.
  const norm = (l) => l.replace(/\d+/g, '#').toLowerCase();
  const seen = new Map();
  pageLines.forEach((ls) => new Set(ls.map(norm)).forEach((k) => seen.set(k, (seen.get(k) || 0) + 1)));
  const limit = Math.max(3, Math.ceil(doc.numPages * 0.35));
  const pages = pageLines.map((ls) =>
    reflow(ls.filter((l) => !pageNo.test(l) && !(doc.numPages >= 4 && l.length < 80 && seen.get(norm(l)) >= limit))));
  const chars = pages.reduce((a, p) => a + p.length, 0);
  if (chars / doc.numPages < 40) {
    // Sin capa de texto (PDF escaneado): se lee cada página como imagen.
    const limit = Math.min(doc.numPages, 100);
    const ocr = [];
    for (let p = 1; p <= limit; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      ocr.push(await recognize(canvas, (f, msg) => onProgress?.(p - 1 + f, limit, `OCR · ${msg}`)));
      onProgress?.(p, limit, 'OCR');
    }
    const t = ocr.join('\n\n');
    if (t.length / limit < 30) { const err = new Error('No se pudo leer texto en este PDF escaneado.'); err.kind = 'scan'; throw err; }
    return { pages: ocr.map(cleanText), text: cleanText(t), note: doc.numPages > limit ? `Solo se leyeron las primeras ${limit} páginas de ${doc.numPages}.` : '' };
  }
  return { pages: pages.map(cleanText), text: cleanText(pages.join('\n\n')) };
}

async function readDocx(file) {
  if (!window.mammoth) await loadScript('../vendor/mammoth.browser.min.js');
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { pages: null, text: cleanText(value) };
}

async function readImage(file, onProgress) {
  const text = await recognize(file, (f, msg) => onProgress?.(f, 1, msg));
  return { pages: null, text };
}

async function readPlain(file) {
  let t = await file.text();
  if (/\.(md|markdown)$/i.test(file.name)) t = t.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1');
  return { pages: null, text: cleanText(t) };
}

export const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.bmp,application/pdf,image/*';
export const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name);

export async function extractFile(file, onProgress) {
  const name = file.name.replace(/\.[^.]+$/, '');
  let r;
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') r = await readPdf(file, onProgress);
  else if (/\.docx$/i.test(file.name)) r = await readDocx(file);
  else if (isImage(file)) r = await readImage(file, onProgress);
  else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith('text/')) r = await readPlain(file);
  else if (/\.doc$/i.test(file.name)) throw new Error('El formato .doc antiguo no se puede leer: guárdalo como .docx o PDF.');
  else throw new Error(`Formato no compatible: ${file.name}`);
  if (!r.text) throw new Error(isImage(file) ? 'No se pudo leer texto en la imagen. Prueba con una captura más nítida o más grande.' : 'No se encontró texto en el archivo.');
  return { name, ...r };
}
