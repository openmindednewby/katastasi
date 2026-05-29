# Browser UI — Workbench (templates, sessions, history, undo/redo)

The `trigger.html` toolbar turns the form into a workbench. Everything is stored locally in your
browser — nothing is sent anywhere. A **snapshot** captures the entire form:

- Pipeline + template selection, AI description + context
- Jira: epic key, component, assignee, reporter, epic markdown, and every task row
- Single Jira ticket fields
- Confluence: parent, labels, and every page row (id / title / markdown)

## The five toolbar groups

| Group | Controls | What it does |
|-------|----------|--------------|
| **Templates** | dropdown · Apply · Delete | Reusable starting points you maintain (e.g. a Confluence parent + children layout). Apply loads one into the form. |
| **Sessions** | dropdown · Load · Delete | Named saved work. Load restores it. |
| **History** | dropdown · Restore | The last **10** auto-snapshots, taken on meaningful events (see below). Restore rolls back to one. |
| *(save)* | name field · Save session · Save template | Type a name, then save the current form as a session **or** a template. Re-saving a name overwrites it. |
| **Undo / Redo** | ↶ Undo · ↷ Redo | Step backward/forward through your edits. |
| *(I/O)* | Export · Export all · Import | Export current config, export the whole library, or import either. |

## Templates vs sessions vs history

- **Templates** — *starting points you reuse.* Build a layout once (e.g. a parent page + 3 child
  pages), `Save template` as "Confluence page group", then `Apply` it whenever you start similar work.
  No built-in templates ship — you create your own from whatever's in the form.
- **Sessions** — *saved work you return to,* by name.
- **History** — *automatic safety net.* You don't manage it; it just keeps your last 10 states.

Applying a template, loading a session, or restoring history is itself **undoable**.

## History — what triggers a snapshot

A new history entry (max 10, newest first, consecutive duplicates skipped) is captured on
**meaningful events**, not every keystroke:

- before loading a session
- before applying a template
- before importing a config
- on **Clear**
- on **Run / publish** (labelled `run: <pipeline>`)

Fine-grained keystroke-level changes are covered by **undo/redo** instead.

## Undo / redo

- Buttons in the toolbar always operate at the **whole-form** level (text edits, adding/removing
  task or page rows, applying templates/sessions, clearing).
- Keyboard: **Ctrl+Z** = undo, **Ctrl+Shift+Z** (or **Ctrl+Y**) = redo — but **only when focus is
  outside a text field**, so your normal in-field typing undo still works as usual.
- Up to 50 steps are kept, per tab, in memory (cleared when the tab closes).

## Multiple tabs

Tabs are **independent but share a library**:

- Each tab edits **its own** form and has **its own** undo/redo and auto-save — opening the same page
  in two tabs never lets one clobber the other.
- Templates, sessions, and history are **shared** and sync **live**: save a template in one tab and
  it immediately appears in the other tabs' dropdowns.
- On reload, a tab restores its own last state; a brand-new tab inherits your most recent work.

## Export / import formats

```jsonc
// Export        — a single configuration
{ "type": "acp-config",  "version": 2, "config": { /* snapshot */ } }

// Export all    — your whole library
{ "type": "acp-library", "version": 2, "templates": { /* name: snapshot */ }, "sessions": { /* … */ } }
```

**Import** is lenient — it accepts `acp-library` (merges templates + sessions), legacy `acp-sessions`,
`acp-config` / any bare object with a `pipeline` field (loaded into the form), or a bare
`{ name: snapshot }` map (merged into sessions). Merges are by name (same name overwrites). Use
*Export all* → share the JSON → *Import* to hand a teammate your starter templates.

## Storage keys

| Key | Scope | Contents |
|-----|-------|----------|
| `acp.templates` | localStorage (shared) | `{ name: snapshot }` reusable templates |
| `acp.sessions` | localStorage (shared) | `{ name: snapshot }` saved sessions |
| `acp.history` | localStorage (shared) | last 10 `{ at, label, snapshot }`, newest first |
| `acp.lastConfig` | localStorage | global last-edited fallback for fresh tabs |
| `acp.tab.live` | sessionStorage (per-tab) | this tab's live form (survives reload, isolated per tab) |

If `localStorage` is unavailable (some locked-down `file://` contexts) the toolbar degrades
gracefully and reports an error instead of saving.
