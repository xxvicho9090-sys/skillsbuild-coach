// Genera public/files.json (ruta + sha1 de cada archivo): la app de escritorio lo usa para actualizarse sola.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const skip = (rel) => rel === 'files.json' || rel.startsWith('__t/');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
export function buildManifest(version) {
  const files = walk(root)
    .map((p) => ({ path: relative(root, p).split(sep).join('/'), buf: readFileSync(p) }))
    .filter((f) => !skip(f.path))
    .map((f) => ({ path: f.path, size: f.buf.length, sha1: createHash('sha1').update(f.buf).digest('hex') }))
    .sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(join(root, 'files.json'), JSON.stringify({ version, files }) + '\n');
  return files.length;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version;
  console.log(`files.json: ${buildManifest(v)} archivos (v${v})`);
}
