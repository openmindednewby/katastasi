# Browser UI — Sessions (save / export / remember)

The `trigger.html` UI keeps your work between visits and lets you manage reusable configurations.
Everything is stored locally in your browser via `localStorage` — nothing is sent anywhere.

## What gets remembered

A **session** is a full snapshot of the form:

- Pipeline + template selection
- AI fields: description, additional context
- Jira: epic key, component, assignee, reporter, epic markdown, and every task row (key / assignee / markdown)
- Single Jira ticket: issue type, component, assignee, reporter, keys, markdown
- Confluence: parent page, labels, and every page row (id / title / markdown)

## The Sessions bar

A toolbar sits at the top of the page:

| Control | What it does |
|---------|--------------|
| **saved sessions** dropdown | Pick a previously saved session |
| **Load** | Load the selected session into the form |
| **Delete** | Remove the selected session |
| **Name this session…** + **Save** | Save the current form as a named session (re-saving the same name overwrites it) |
| **Export current** | Download the current form as `acp-config-<timestamp>.json` |
| **Export all** | Download every saved session as `acp-sessions-<timestamp>.json` |
| **Import** | Load sessions or a single config from a `.json` file |

## Remember-last (automatic)

As you type, the form auto-saves to `localStorage` (debounced). When you reopen or refresh the page,
your last configuration is restored automatically — no action needed. **Clear** also resets the
remembered state.

## Export / import formats

Two shapes are produced and accepted:

```jsonc
// Export current  — a single configuration
{ "type": "acp-config", "version": 1, "config": { /* form snapshot */ } }

// Export all — a map of named sessions
{ "type": "acp-sessions", "version": 1, "sessions": { "My session": { /* snapshot */ } } }
```

**Import** is lenient — it accepts either shape above, a bare config (any object with a `pipeline`
field, loaded straight into the form), or a bare `{ name: snapshot }` map (merged into your saved
sessions). Importing sessions **merges** by name (same name overwrites).

Use this to share a set of starter configurations with a teammate: *Export all* → send the JSON →
they *Import* it.

## Storage keys

| Key | Contents |
|-----|----------|
| `acp.lastConfig` | The auto-saved last form state |
| `acp.sessions` | `{ name: snapshot }` map of named sessions |

Clearing browser site data for the page removes both. If `localStorage` is unavailable (some
locked-down `file://` contexts), the bar degrades gracefully and shows an error instead of saving.
