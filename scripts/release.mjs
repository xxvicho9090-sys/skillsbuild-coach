// Publica una versión nueva: node scripts/release.mjs 1.1.0 "Qué cambió"
// Actualiza app.js, sw.js y version.json para que las PWA instaladas detecten la actualización.
import { readFileSync, writeFileSync } from 'node:fs';

const [version, ...rest] = process.argv.slice(2);
const note = rest.join(' ').trim();
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !note) {
  console.error('Uso: node scripts/release.mjs <x.y.z> "nota de la versión"');
  process.exit(1);
}
const file = (p) => new URL(`../public/${p}`, import.meta.url);

const app = readFileSync(file('app.js'), 'utf8');
if (!/const APP_VERSION = '[\d.]+';/.test(app)) throw new Error('No encuentro APP_VERSION en app.js');
writeFileSync(file('app.js'), app.replace(/const APP_VERSION = '[\d.]+';/, `const APP_VERSION = '${version}';`));

const sw = readFileSync(file('sw.js'), 'utf8');
writeFileSync(file('sw.js'), sw.replace(/const CACHE = 'sbc-[\d.]+';/, `const CACHE = 'sbc-${version}';`));

const meta = JSON.parse(readFileSync(file('version.json'), 'utf8'));
const notes = [note, ...(meta.notes || [])].slice(0, 5);
writeFileSync(file('version.json'), JSON.stringify({ version, date: new Date().toISOString().slice(0, 10), notes }, null, 2) + '\n');

console.log(`Versión ${version} lista. Haz commit y push: Render la publica y las apps instaladas mostrarán "Hay una versión nueva".`);
