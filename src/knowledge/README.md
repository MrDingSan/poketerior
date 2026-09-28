# Knowledge Modules

The first retrieval pass is intentionally dependency-free. `retrieve.js` reads
Markdown files from:

- `knowledge-base/notes/`
- `knowledge-base/examples/`

It chunks by heading, scores chunks by keyword overlap with the current hand
node, and returns the most relevant snippets for the Gemini prompt.

Future upgrades:

- parse PDFs/text exports into private raw notes
- tag chunks by street, position, board texture, SPR, and action line
- build a vector index for semantic retrieval
- keep retrieved snippets short enough for precise LLM context

## Harrington-style analysis

The Harrington cash-game extract is kept outside the default knowledge search
path and is retrieved only by the dedicated Harrington analysis endpoint. These files are private and git-ignored; when they are absent the endpoint still runs without retrieved excerpts:

- `data/harrington/harrington_theory.md` is used as strategic knowledge.
- `data/harrington/harrington_hands.md` is used only as a writing-format and
  reasoning-style reference, because OCR and missing table images make the
  original examples unreliable as factual hand records.

The browser calls `POST /api/analyze/harrington` after the normal analysis and
renders the result in the separate "Harrington Style" section.
