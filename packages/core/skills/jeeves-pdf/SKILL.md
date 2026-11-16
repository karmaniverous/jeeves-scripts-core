---
name: jeeves-pdf
description: Read a PDF - text via convert-pdf-to-md, layout or visuals via convert-pdf-to-png and view_image, scanned pages via the pdf tool; no Python needed.
metadata: { 'openclaw': { 'requires': { 'env': ['JEEVES_SCRIPTS_DIR'] } } }
---

# PDFs

Core reads PDFs with its own npm dependencies (pdf-parse and its canvas): no Python, PyMuPDF or poppler on any host. [convert.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/convert.md#reading-pdfs-from-a-session) has both runnables, their arguments and output.

## The directory limit

OpenClaw's `pdf` and `view_image` tools read only files in the agent workspace and in OpenClaw's own media and temp directories (`media/` under the OpenClaw state directory). No config setting widens that: `tools.fs.workspaceOnly: false` doesn't, and there is no setting for extra roots. A PDF anywhere else (the corpus, a data drive) is out of their reach until you convert it or copy it in. The runnables below read any path.

## Pick a route

1. **The words** (summarise, quote, search, answer from the text): `node "$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js" run convert-pdf-to-md <in.pdf> <out.md>`, then read or grep `out.md`. Check its frontmatter: `pages`, and `textlessPages` when some pages have no text layer (the run also warns on stderr). Those pages are scanned or image-only: take them by route 2 or 3.
2. **Layout or visuals** (a form, a table's look, a chart, a signature, "what does page 3 look like?"): `node "$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js" run convert-pdf-to-png <in.pdf> <outDir> --pages 3` (pages like `1-3,7`; default all; `--scale` default 1.5, raise it for small print). Put `outDir` in the workspace or OpenClaw's media directory, then `view_image` each `<name>-p<N>.png` it prints. Render only the pages you need.
3. **Analysis of the whole document, or scanned pages you must read as text**: copy the PDF into the workspace and give it to the `pdf` tool.

## Operator rules

- Write outputs to scratch locations (the workspace, a temp directory), never next to a source file in the corpus unless asked to file the conversion.
- Delete page images and copied PDFs once you have answered.
- A long document's Markdown is read in ranges or by a sub-agent, never whole into context.
