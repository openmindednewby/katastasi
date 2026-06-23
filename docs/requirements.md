# Katastasi — Requirements

The product's capability requirements, tracked by Katastasi itself (dogfood). Each `KAT-<n>` is a
capability; tasks in `.acp/tasks/` link to these. Tag tests with `@KAT-<n>` to make a requirement
**verified** in `acp trace`.

## Shipped

- KAT-1 Markdown ⇄ Jira/Confluence both ways (publish / pull / push-folder, mermaid round-trip).
- KAT-2 Requirements traceability (`acp trace`): link tests ↔ requirements ↔ results at the git commit;
  regression/stale/code-gap detection; run history; secured web portal; autodetect init.
- KAT-3 Task tracking (`.acp/tasks`): local markdown tasks linked to requirements + tests, board,
  configurable statuses, done-but-not-verified drift check, Jira read-only import. (v0.3.0)
- KAT-4 Acceptance test runner (`katastasi test`): requirement-first HTTP + CLI cases (spec files +
  inline acp-test blocks), assertions + capture-chaining, JUnit → trace verifies. (v0.4.0)
- KAT-6 AI authoring (`acp analyze` / `pipeline`): gap analysis → tech docs + tasks + tagged tests +
  executable acceptance specs; clarify→answer loop.
- KAT-7 Distribution: npm (`katastasi` + `@dloizides/katastasi`), Docker (GHCR), GitHub Action,
  GitLab/pre-commit templates.

## Pending

- KAT-5 Bidirectional sync (Phase 3): a 3-way reconciler (base/local/remote), revision-tracked,
  field-aware, conflict-flagging — never loses an edit. (scoped, not built — docs/PHASE-3-DESIGN.md)
- KAT-8 Breadth & polish (Phase 4): more test/result frameworks (pytest/go/cypress), more CI providers,
  a docs site, flaky-test detection, richer examples.
- KAT-9 Proven on a real project (dogfood): Katastasi tracks its own repo + verified against real
  Jira/Confluence and a real AI model (today everything is self-tested only).
