// Copia la web (../public) dentro de la app de escritorio para que funcione sin conexión.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../public/', import.meta.url));
const dst = fileURLToPath(new URL('./web/', import.meta.url));
if (!existsSync(src)) throw new Error('No encuentro ../public');
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true, filter: (p) => !p.includes('__t') });
console.log('web copiada a desktop/web');
