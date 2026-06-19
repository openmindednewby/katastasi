# docs/_tools — interactive Q&A generator

`build-questions-html.js` turns an **open-questions Markdown** file into a self-contained interactive HTML: it renders the Flow-overview Mermaid diagram, shows the questions as answerable controls, **recolours the matching diagram node live** as you answer, and **exports answers + comments** to Markdown/JSON.

## Usage

```bash
node docs/_tools/build-questions-html.js <input.md> [output.html]
# e.g.
node docs/_tools/build-questions-html.js docs/CLS-13631/open-questions.md docs/CLS-13631/open-questions.html
```

Output defaults to `<input>.html` beside the source. **Mermaid is vendored** at `docs/_tools/vendor/mermaid.min.js` and referenced by a relative path, so the viewer **works offline** (keep the `docs/_tools/vendor/` folder alongside the repo). `template.html` holds the UI/logic; the generator only injects data and the relative Mermaid path.

## Conventions the Markdown must follow

The generator is deliberately simple — it relies on these conventions, so keep new open-questions docs consistent:

1. **Title** — the first `#` H1 becomes the page title.
2. **Flow overview** — a `## Flow overview` heading followed by a fenced ```` ```mermaid ```` block. The **first** mermaid block under that heading is the interactive diagram.
3. **Question ↔ node binding** — every node that corresponds to a question carries a `Q<n>` token in its label, e.g. `ESYS{"Q1 · Editing allowed?"}`. The generator maps `Q<n>` → that node id by scanning node definitions. Put each `Q<n>` token on **exactly one** node.
4. **Colour classes** — the diagram defines `classDef pending` (amber) and `classDef confirmed` (green) and assigns nodes with `class A,B,… pending;` / `class … confirmed;`. Unanswered question nodes should be in the `pending` set; answering one recolours it to a vivid green `answered` style at runtime, and the **rejected branches' downstream nodes turn red `disabled`** (computed from edge liveness — a node with no remaining live incoming path is dimmed red).
5. **QA list** — a `## Open questions (QA)` heading, then one top-level bullet per question:
   ```markdown
   - **Q1 — Short question title?**
     - [ ] Option A
     - [ ] Option B
   ```
   Each question is `- **Q<n> — <title>:**` (em-dash or hyphen, trailing `:` optional) with two or more nested `  - [ ] <option>` lines. The section ends at the next `##` heading.
6. **Option ↔ branch order** — for a question whose node has outgoing branches, list the QA options in the **same order** as the node's outgoing edges in the diagram. The viewer maps option *i* → branch *i*, so picking an option keeps that branch and disables the siblings. (Leaf decision nodes with no outgoing edges just turn green when answered — nothing to disable.)

A question whose `Q<n>` is not found on any diagram node still renders, but is flagged `(unmapped)` and won't recolour anything — the build log lists these.

## What the HTML does

- One single-select group per question + a per-question **comment** box, plus a **General notes** box.
- Answering recolours the bound node (amber → green) and **dims the rejected branches red** (`disabled`); the `X / N answered` counter updates.
- **Export PNG** rasterises the current diagram (white background, 2× scale) for pasting into Confluence; **Export .md** / **Export .json** download the answers + every comment + general notes; **Copy answers** puts the Markdown on the clipboard.
- A **draggable splitter** between the diagram and the questions lets you enlarge the diagram on demand (drag the vertical bar; double-click it to reset).

## Reusing for a new ticket

1. Write `docs/CLS-XXXXX/open-questions.md` following the conventions above.
2. Run the generator pointing at it.
3. Commit both the `.md` (source of truth) and the generated `.html`. Re-run the generator whenever the `.md` changes.
