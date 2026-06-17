# Task: Reverse pipeline — Jira / Confluence → markdown folder

## Goal
The opposite of the existing publish flow. Given an **epic key/URL** (or a **Confluence page
id/URL**) plus a **target directory**, fetch the issue/page tree, convert it to markdown, and
write a round-trippable folder so the existing forward commands (`acp jira` / `acp confluence`)
can push it back.

## Decisions (locked with owner)
- **Backend:** Direct REST. Implements the long-reserved `ACP_BACKEND=direct` read path in TS
  core, using the existing `.env` `JIRA_*` / `CONFLUENCE_*` creds (Basic auth). No n8n round-trip,
  no AI (reads only), fully unit-testable.
- **Surfaces (all three, sharing one core):**
  - CLI: `acp pull-jira <epicRef> <dir>` and `acp pull-confluence <pageRef> <dir>`.
  - MCP tools: `jira_to_markdown`, `confluence_to_markdown`.
  - Bash: `scripts/jira-to-folder.sh`, `scripts/confluence-to-folder.sh` (+ `.ps1`).
- **Fidelity:** Round-trippable — emit the exact forward markdown shape (`# Title`, description,
  `## Acceptance Criteria` / `## Priority` / `## Estimate` / `## Component` / `## Labels`). Extra
  metadata (key, status, assignee, url, parent) is preserved in a sidecar manifest, not the body.
- **Scope:** Fully recursive. Jira: epic → stories → sub-tasks. Confluence: page + descendant tree
  (nested subfolders).

## Folder layout (round-trip target)
Jira (`<dir>`):
```
epic.md                       # the epic, forward format
task-01-<slug>.md             # story (parent = epic)
task-01-<slug>/               # only if that story has sub-tasks
  subtask-01-<slug>.md
task-02-<slug>.md
acp-pull.json                 # manifest: ordered [{file, key, type, parentKey, url, status}]
```
Confluence (`<dir>`):
```
page.md                       # root page, forward format
01-<child-slug>/
  page.md
  01-<grandchild-slug>/
    page.md
acp-pull.json                 # manifest: [{dir, pageId, parentPageId, url, title}]
```

## Reference REST endpoints
- Jira issue: `GET /rest/api/3/issue/{key}?fields=summary,description,labels,priority,issuetype,components,parent,subtasks,status`
  (`description` is ADF).
- Jira children of epic: `GET /rest/api/3/search?jql=parent={KEY}` (stories), then `parent={STORY}` (sub-tasks),
  or walk `fields.subtasks[]`.
- Confluence page: `GET /wiki/rest/api/content/{id}?expand=body.storage,version,title,space`
  (`body.storage.value` is storage-format XHTML).
- Confluence children: `GET /wiki/rest/api/content/{id}/child/page?expand=body.storage` (paged).

## Structure (new files)
```
src/core/
  atlassian.ts        # direct REST client (Basic auth from .env): getIssue, searchChildren, getPage, getChildPages
  adfToMarkdown.ts    # ADF doc -> markdown
  storageToMarkdown.ts# Confluence storage XHTML -> markdown
  pull.ts             # pullJira(epicRef, dir, opts) / pullConfluence(pageRef, dir, opts) — fetch, convert, write tree + manifest
  config.ts           # +jira/+confluence cred blocks
  types.ts            # +pull input/result types
src/cli/index.ts      # + pull-jira / pull-confluence commands
src/mcp/server.ts     # + jira_to_markdown / confluence_to_markdown tools
scripts/              # jira-to-folder.sh + .ps1, confluence-to-folder.sh + .ps1
```

## Progress
- [x] config: jira/confluence cred blocks (`getJiraCreds`/`getConfluenceCreds`/`basicAuthHeader`)
- [x] core: atlassian REST client (`atlassian.ts` — getIssue/getChildIssues/getPage/getChildPages + ref parsers, paged)
- [x] core: adfToMarkdown converter (`adfToMarkdown.ts` — para/heading/lists/code/table/quote/marks/links, graceful unknowns)
- [x] core: storageToMarkdown converter (`storageToMarkdown.ts` — tolerant XHTML tokenizer; code macro/task-list/tables/lists; strips footer; entity decode)
- [x] core: pull orchestration (`pull.ts` — recursive, forward-format emit, nested folders, `acp-pull.json` manifest, non-empty-dir guard)
- [x] CLI: `acp pull-jira <epic> <dir>` / `acp pull-confluence <page> <dir>` (`--no-recursive`, `--force`)
- [x] MCP: `jira_to_markdown` / `confluence_to_markdown` tools
- [x] bash + ps1 scripts (`jira-to-folder` / `confluence-to-folder`, wrap the CLI = one converter source of truth)
- [x] unit tests: 17 converter/helper + 4 integration (mock REST server → real folder tree/manifest) = **21 pass**
- [x] docs: README (reverse section + roadmap) + docs/CLI_AND_MCP.md (config, CLI, MCP table, roadmap)
- [x] build clean, typecheck clean, `npm test` 21/21

## Notes / decisions made during build
- Reused the repo's reserved `ACP_BACKEND=direct` rationale: reverse reads go **direct REST** (no n8n, no AI).
- Bash/PS1 scripts **delegate to the CLI** rather than reimplementing ADF→md in jq (would be a second,
  drifting copy of the converter). Single source of truth = `src/core`.
- Round-trip + recursive reconciled via nested folders + the `acp-pull.json` manifest. Flat re-publish
  (epic + stories) works today via existing `acp jira`; full recursive re-publish (sub-tasks/child pages)
  is the proposed follow-up `acp push-folder` (logged in roadmap).
- `test` script now builds then runs `node --test "test/**/*.test.js"` against compiled dist (plain-JS tests,
  no TS-in-node loader friction).

## Follow-up DONE: `acp push-folder` (recursive re-publish)
Manifest-driven complement — edit the pulled markdown, push the whole tree back via direct REST.
- [x] Ported the n8n forward converters to TS: `markdownToAdf.ts` (from `markdown-to-jira` Code
      node) + `markdownToStorage.ts` (from `markdown-to-confluence`, incl. the new XML-escape fix).
      Fixed a latent off-by-one in the storage task-list branch (n8n `for`-loop `continue` skipped
      the line after a task list).
- [x] `atlassian.ts`: write methods `createIssue` / `updateIssue` / `createPage` / `updatePage`
      (refactored the request helper to a shared `sendJson` for GET/POST/PUT, tolerant of 204).
- [x] `push.ts`: reads `acp-pull.json`, walks parents-before-children, updates by key/id in place,
      creates entries lacking a key/id (parent links remapped old→live), Confluence version bump.
      `parseIssueMarkdown` splits the body from the trailing Priority/Component/Labels meta sections
      (Acceptance Criteria stays in the description body). `--dry-run` reports actions, no calls.
- [x] CLI `acp push-folder <dir> [--dry-run]` + MCP tool `push_folder`.
- [x] Tests: +12 (converters, markdown parsing, integration vs mock REST for jira update + dry-run
      + confluence version-bump + missing-manifest) → **33 pass total**.
- [x] Docs updated (README + CLI_AND_MCP): reverse re-publish section, MCP table, roadmap.

## Remaining (not done — needs live Atlassian)
- [ ] End-to-end run against a real Jira/Confluence sandbox (verified only against a mock REST server)
- [ ] Wire `ACP_BACKEND=direct` into the forward `acp jira` / `acp confluence` publish commands so
      they reuse the now-ported TS converters instead of n8n (Stage 2; converters now exist).

## Status: CODE-COMPLETE — reverse pull + recursive push-folder (build/typecheck/33 tests green; live Atlassian run pending creds)
