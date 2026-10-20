# SkillsBuild Coach

PWA para estudiar cursos (pensada para IBM SkillsBuild): **ordena tus apuntes, PDFs y capturas de pantalla**, genera quizzes y tarjetas de repaso espaciado, y todo corre con una IA **local** (Ollama, modelo de ~2 GB). Tus apuntes no salen de tu computador.

## Qué hace

- **Importa** PDF, Word (.docx), .txt/.md, texto pegado y **capturas de pantalla** (arrástralas o pega con Ctrl+V). Los PDF escaneados y las imágenes se leen con OCR local (español + inglés).
- **Ordena con IA**: ficha de estudio (resumen + ideas clave por tema), glosario inglés→español, preguntas de opción múltiple y tarjetas.
- **Estudia**: quiz con explicación, método Feynman (cobertura de conceptos + evaluación), mini proyecto por módulo y repaso espaciado (10 min · 1 · 3 · 7 · 14 · 30 · 60 días).
- **Sin IA también sirve**: lectura, índice detectado, búsqueda, tarjetas manuales y repaso funcionan aunque Ollama esté apagado.
- **Instalable** (PWA), funciona sin conexión y **se actualiza sola**: avisa "Hay una versión nueva" y se recarga con un toque.
- Copia de seguridad en JSON (Ajustes).

## Conectar Ollama

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
node scripts/release.mjs 1.1.0 "Qué cambió"
git add -A && git commit -m "v1.1.0" && git push
```

Render (sitio estático, `render.yaml`) publica solo; las apps instaladas consultan `version.json` al abrir y cada 30 min y muestran el aviso de actualización.
