# SkillsBuild Coach

PWA para estudiar cursos (pensada para IBM SkillsBuild): **ordena tus apuntes, PDFs y capturas de pantalla**, genera quizzes y tarjetas de repaso espaciado, y todo corre con una IA **local** (Ollama, modelo de ~2 GB). Tus apuntes no salen de tu computador.

## Qué hace

- **Importa** PDF, Word (.docx), .txt/.md, texto pegado y **capturas de pantalla** (arrástralas o pega con Ctrl+V). Los PDF escaneados y las imágenes se leen con OCR local (español + inglés).
- **Ordena con IA**: ficha de estudio (resumen + ideas clave por tema), glosario inglés→español, preguntas de opción múltiple y tarjetas.
- **Estudia**: quiz con explicación, método Feynman (cobertura de conceptos + evaluación), mini proyecto por módulo y repaso espaciado (10 min · 1 · 3 · 7 · 14 · 30 · 60 días).
- **Sin IA también sirve**: lectura, índice detectado, búsqueda, tarjetas manuales y repaso funcionan aunque Ollama esté apagado.
- **Instalable** (PWA), funciona sin conexión y **se actualiza sola**: avisa "Hay una versión nueva" y se recarga con un toque.
- Copia de seguridad en JSON (Ajustes).

## App de escritorio (Windows) · Ollama integrado

Descarga `SkillsBuild-Coach-win-x64.zip` desde [Releases](https://github.com/xxvicho9090-sys/skillsbuild-coach/releases/latest), descomprímelo y abre **SkillsBuild Coach.exe**. Es esta misma app en su propia ventana:

- **Detecta tu Ollama sola** y lo inicia si está instalado pero apagado. Sin servidor, sin puertos y sin `OLLAMA_ORIGINS`: la ventana usa el origen `app://sbc`, que Ollama acepta por defecto.
- Funciona sin conexión y **se actualiza sola**: baja los archivos nuevos de la web publicada (`files.json`) y avisa para recargar.
- Código en `desktop/` (Electron). Para generarla: `cd desktop && npm install && npm run pack`.

## Modo local con navegador (alternativa)

Haz doble clic en **`Iniciar-Coach.vbs`** (sin ventana) o **`Iniciar-Coach.bat`** (con ventana). Eso:

- inicia Ollama si está apagado y trae las novedades de GitHub (`git pull`);
- sirve la app en `http://localhost:5173` y conecta con Ollama **por el mismo origen** (`/ollama`), así que no hay que configurar `OLLAMA_ORIGINS` ni permisos del navegador;
- la app lo detecta sola: en Ajustes aparece "Integrado (servidor local)". Puedes instalarla como app desde ahí.

`Iniciar-Coach.bat --lan` la abre también a tu Wi-Fi para usarla **desde el celular** (`http://IP-de-tu-PC:5173`). El puente a Ollama solo acepta peticiones del propio sitio (bloquea otros orígenes y ataques de DNS rebinding).

Los datos de la web publicada y los del modo local son independientes: pásalos con Exportar/Importar en Ajustes.

## Conectar Ollama sin el modo local

```bash
ollama pull qwen2.5:3b
```

Si usas la versión publicada, Ollama debe permitir esa web (una sola vez). En Windows (PowerShell), reemplaza la URL por la de tu despliegue y reinicia Ollama:

```powershell
setx OLLAMA_ORIGINS "https://skillsbuild-coach.onrender.com"
```

macOS: `launchctl setenv OLLAMA_ORIGINS "https://…"`. La pantalla Ajustes muestra el comando exacto con tu dirección y comprueba la conexión. Chrome puede pedir permiso para acceder a la red local: acéptalo. Desde un celular no hay `localhost` de tu PC: úsalo en el computador donde corre Ollama.

Modelos recomendados (≈2 GB): `qwen2.5:3b` (por defecto), `llama3.2:3b`, `gemma2:2b`.

## Desarrollo

```bash
node scripts/serve.mjs 5173      # http://localhost:5173 (Ollama ya permite localhost)
```

Sin build: HTML + JS (módulos ES) en `public/`. Las librerías (pdf.js, mammoth, tesseract.js y sus datos de idioma) están en `public/vendor/` para que funcione offline.

## Publicar una versión nueva

```bash
node scripts/release.mjs 1.1.0 "Qué cambió"   # también regenera public/files.json
git add -A && git commit -m "v1.1.0" && git push
```

Render (sitio estático, `render.yaml`) publica solo; las apps instaladas consultan `version.json` al abrir y cada 30 min y muestran el aviso de actualización.
