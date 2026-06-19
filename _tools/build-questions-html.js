#!/usr/bin/env node
/**
 * build-questions-html.js
 * Generate a self-contained interactive Q&A HTML from a conventions-following Markdown file.
 *
 *   node build-questions-html.js <input.md> [output.html]
 *
 * Defaults output to <input>.html next to the source. See README.md for the conventions
 * the Markdown must follow (Flow overview mermaid + Q-numbered nodes + "Open questions (QA)" list).
 */
"use strict";
const fs = require("fs");
const path = require("path");

function fail(msg) { console.error("build-questions-html: " + msg); process.exit(1); }

const inPath = process.argv[2];
if (!inPath) fail("usage: node build-questions-html.js <input.md> [output.html]");
const outPath = process.argv[3] || inPath.replace(/\.md$/i, ".html");
const tmplPath = path.join(__dirname, "template.html");

if (!fs.existsSync(inPath)) fail("input not found: " + inPath);
if (!fs.existsSync(tmplPath)) fail("template not found: " + tmplPath);

const md = fs.readFileSync(inPath, "utf8");
const template = fs.readFileSync(tmplPath, "utf8");

// 1. Title = first H1.
const title = (md.match(/^#\s+(.+?)\s*$/m) || [, "Open Questions"])[1].trim();

// 2. Flow overview mermaid = first ```mermaid block after the "## Flow overview" heading.
function extractFlowMermaid(src) {
  const after = src.split(/^##\s+Flow overview\s*$/m)[1];
  if (!after) fail('no "## Flow overview" section found');
  const m = after.match(/```mermaid\s*([\s\S]*?)```/);
  if (!m) fail('no mermaid block under "## Flow overview"');
  return m[1].replace(/\s+$/, "");
}

// 3. Map Q<n> -> node id by scanning node definitions  ID["...Q<n>..."] / ID{...} / ID[[...]] ...
function mapQuestionsToNodes(mermaid) {
  const map = {};
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*[\[\{(]+\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(mermaid))) {
    const q = m[2].match(/Q(\d+)/);
    if (q) map[Number(q[1])] = m[1];
  }
  return map;
}

// 4. Parse the "## Open questions (QA)" list into [{n,title,options}].
function parseQuestions(src) {
  const after = src.split(/^##\s+Open questions \(QA\)\s*$/m)[1];
  if (!after) fail('no "## Open questions (QA)" section found');
  const questions = [];
  let cur = null;
  for (const line of after.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) break;                       // next H2 ends the section
    const qm = line.match(/^- \*\*Q(\d+)\s*[—-]\s*(.+?):?\*\*\s*$/);
    if (qm) { cur = { n: Number(qm[1]), title: qm[2].trim(), options: [] }; questions.push(cur); continue; }
    const om = line.match(/^\s+- \[[ xX]?\]\s+(.+?)\s*$/);
    if (om && cur) cur.options.push(om[1].trim());
  }
  if (!questions.length) fail("no questions parsed from the QA section");
  return questions;
}

// 5. Parse edges  "A -->|label| B"  /  "A --> B"  ->  [[src, tgt], ...]
function parseEdges(src) {
  const edges = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) continue;
    const i = line.indexOf("-->");
    if (i < 0) continue;
    const sm = line.slice(0, i).trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (!sm) continue;
    const right = line.slice(i + 3).replace(/^\s*\|[^|]*\|/, "");   // drop the edge label
    const tm = right.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (!tm) continue;
    edges.push([sm[1], tm[1]]);
  }
  return edges;
}
const outTargets = (edges, node) => edges.filter(e => e[0] === node).map(e => e[1]);

const mermaid = extractFlowMermaid(md);
const nodeOf = mapQuestionsToNodes(mermaid);
const edges = parseEdges(mermaid);
// Each question's options map by index to the decision node's ordered outgoing branches,
// so the viewer can mark the rejected branches' downstream nodes as disabled (red).
const questions = parseQuestions(md).map(q => {
  const node = nodeOf[q.n] || null;
  return { n: q.n, title: q.title, options: q.options, node, targets: node ? outTargets(edges, node) : [] };
});

// Local (vendored) mermaid, path relative to the output file, so the viewer works offline.
const vendorAbs = path.join(__dirname, "vendor", "mermaid.min.js");
if (!fs.existsSync(vendorAbs)) console.warn("build-questions-html: WARNING vendored mermaid not found at " + vendorAbs);
const mermaidSrc = path.relative(path.dirname(path.resolve(outPath)), vendorAbs).split(path.sep).join("/");

const data = { title, mermaid, questions, edges };
// Safe to embed in a <script>: escape "<" so a "</script>" inside a label can't close the tag.
const json = JSON.stringify(data).replace(/</g, "\\u003c");

const html = template
  .replace(/\{\{TITLE\}\}/g, title.replace(/</g, "&lt;"))
  .replace(/\{\{MERMAID_SRC\}\}/g, mermaidSrc)
  .replace("window.__DATA__ || ", "window.__DATA__ = " + json + ";\nwindow.__DATA__ || ");

fs.writeFileSync(outPath, html, "utf8");
const unmapped = questions.filter(q => !q.node).map(q => "Q" + q.n);
const branched = questions.filter(q => q.targets.length).length;
console.log("wrote " + outPath + " — " + questions.length + " questions (" + branched + " branched), " +
  edges.length + " edges, mermaid=" + mermaidSrc +
  (unmapped.length ? "; UNMAPPED: " + unmapped.join(", ") : "; all mapped"));
