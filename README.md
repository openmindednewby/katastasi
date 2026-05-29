# AI Confluence Pipeline

Automate technical analysis with AI, push it to Confluence, and create Jira tasks — all in one workflow.

Built for **tech leads** who spend too much time writing technical docs and creating tickets manually.

```
Feature Description → AI Analysis → Confluence Page → Jira Tasks
```

![AI Confluence Pipeline UI](docs/screenshot.png)

## What It Does

1. You describe a feature, bug, or research spike
2. AI (Claude or OpenAI) generates a structured technical analysis:
   - Architecture overview with component breakdown
   - API contracts with request/response examples
   - Database schema changes
   - Edge cases and security considerations
   - Testing strategy
   - Task breakdown with acceptance criteria
3. Creates a formatted Confluence page with the full analysis
4. Creates Jira tickets for each task, linked back to the Confluence page

## Quick Start

### Fastest: CLI only (no Docker, no API keys)

If you have the `claude` CLI (Claude Code) or GitHub Copilot (`gh` CLI):

```bash
git clone https://github.com/openmindednewby/ai-confluence-pipeline.git
cd ai-confluence-pipeline

# Option A: Claude Code CLI
./scripts/cli-preview.sh "Add user notification preferences"

# Option B: GitHub Copilot CLI
gh extension install github/gh-models   # one-time setup
./scripts/gh-models-preview.sh "Add user notification preferences"
```

Output saved to `preview/` as markdown + JSON. See **[CLI Setup Guide](docs/CLI_SETUP.md)** for full details.

### Full pipeline: n8n + Docker (browser UI, auto-publish to Confluence/Jira)

```bash
git clone https://github.com/openmindednewby/ai-confluence-pipeline.git
cd ai-confluence-pipeline

# 1. Configure
cp .env.example .env
# Edit .env with your API keys (see docs/SETUP.md)

# 2. Start n8n
docker compose up -d

# 3. Import workflow
# Open http://localhost:10353 → Import → workflows/preview-pipeline.json

# 4. Run it
./scripts/trigger-preview.sh "Add user notification preferences with email and push channels"
```

See **[Setup Guide](docs/SETUP.md)** for full walkthrough.

## Example Output

**Input:**
> "Add user notification preferences with email, push, and in-app channels. Users should be able to configure which events trigger notifications and through which channels."

**Output:**
- Confluence page with architecture, API specs, database changes, edge cases, and task breakdown
- 6-8 Jira tickets with acceptance criteria, estimates, and component labels

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────┐
│   Trigger    │────▶│  Claude AI   │────▶│  Confluence   │────▶│  Jira   │
│  (webhook)   │     │  (analysis)  │     │  (page)       │     │ (tasks) │
└─────────────┘     └─────────────┘     └──────────────┘     └─────────┘
       │                    │                    │                   │
       │              Structured            Formatted           Tickets
       │              JSON output           HTML page          with AC
       │                                                     & estimates
  Feature desc,
  options, context
```

**Orchestrated by n8n** (self-hosted, open-source workflow automation).

## Template Registry

Not every scenario needs the same output. The template registry routes each type of work to the right destination.

### Full Pipeline (Confluence + Jira)

| Template | Use Case | Jira Structure |
|----------|----------|----------------|
| [New Feature](templates/full-pipeline/new-feature.md) | Feature implementation | Epic + Stories |
| [Tech Migration](templates/full-pipeline/tech-migration.md) | Stack/library migration | Phased Epics |
| [Large Refactoring](templates/full-pipeline/large-refactoring.md) | Major code restructuring | Epic + Stories |
| [API Breaking Change](templates/full-pipeline/api-breaking-change.md) | Contract changes with consumer impact | Epic + Stories |
| [Security Audit](templates/full-pipeline/security-audit.md) | Vulnerability findings + remediation | Epic + Stories |
| [Performance Optimization](templates/full-pipeline/performance-optimization.md) | Bottleneck analysis + fix plan | Epic + Stories |

### Confluence Only (Documentation, no tickets)

| Template | Use Case |
|----------|----------|
| [ADR](templates/confluence-only/adr.md) | Architecture Decision Records |
| [Post-Mortem](templates/confluence-only/post-mortem.md) | Incident reports (blameless) |
| [Runbook](templates/confluence-only/runbook.md) | Operational procedures for on-call |

### Jira Only (Quick tickets, no docs)

| Template | Use Case | Jira Structure |
|----------|----------|----------------|
| [Bug Fix](templates/jira-only/bug-fix.md) | Bug report → ticket | Single Bug ticket |
| [Dependency Update](templates/jira-only/dependency-update.md) | Package upgrades | Story + Subtasks |
| [Tech Debt](templates/jira-only/tech-debt.md) | Tech debt backlog items | Single Story |
| [Quick Enhancement](templates/jira-only/quick-enhancement.md) | Small improvements (<1 day) | Single Story |

### Active n8n Prompts

The prompts in `prompts/` are what the current n8n workflow uses. The templates above are the next-gen format (same concepts, more structured):

| Template | Use Case |
|----------|----------|
| [Technical Analysis](prompts/technical-analysis.md) | New features (original format) |
| [Bug Analysis](prompts/bug-analysis.md) | Bug reports (original format) |
| [Spike Analysis](prompts/spike-analysis.md) | Research/evaluation (original format) |

## Workflows

There are 8 ways to use the pipeline. Pick the one that fits your setup:

### AI Analysis Pipelines

| # | Pipeline | AI Backend | Requires | Browser UI | Script / Workflow |
|---|----------|-----------|----------|-----------|-------------------|
| 1 | **gh models CLI** | GitHub Copilot (`gh models run`) | `gh` CLI + extension | No | `scripts/gh-models-preview.sh` |
| 2 | **Claude Code CLI** | Claude Code (`claude -p`) | `claude` CLI | No | `scripts/cli-preview.sh` |
| 3 | **n8n Preview** | GitHub Models REST API | Docker + n8n | Yes | `workflows/preview-pipeline.json` |
| 4 | **n8n Iterative Preview** | GitHub Models REST API | Docker + n8n | Yes | `workflows/iterative-preview-pipeline.json` |
| 5 | **n8n Direct Push** (free) | GitHub Models REST API | Docker + n8n | Yes | `workflows/github-models-pipeline.json` |
| 6 | **n8n Direct Push** (paid) | Anthropic REST API | Docker + n8n + API key | Yes | `workflows/technical-analysis-pipeline.json` |

### Markdown → Jira / Confluence (no AI, publish your own files)

| # | Script | What It Does | Requires |
|---|--------|-------------|----------|
| 7 | **folder-to-jira** | Create Jira Epic + linked Stories from markdown files | `.env` with `JIRA_*` |
| 8 | **folder-to-confluence** | Create Confluence page from markdown files | `.env` with `CONFLUENCE_*` |

Pipelines 1-2 are **standalone scripts** — no Docker, no n8n, no API keys.
Pipelines 3-6 require **Docker + n8n** and support the browser UI (`trigger.html`).
Scripts 7-8 publish your **own markdown files** to Jira/Confluence — no AI involved.

> **Full docs:** [Workflows Reference](docs/WORKFLOWS.md) | [CLI Setup](docs/CLI_SETUP.md) | [n8n Setup](docs/SETUP.md)

---

### CLI Workflows (no Docker, no n8n, no API keys)

#### GitHub Copilot CLI (`gh models`)

Uses the `gh-models` extension to call models on the GitHub Models marketplace. Default model: `anthropic/claude-4-opus`.

```bash
# One-time setup
gh extension install github/gh-models

# Run
./scripts/gh-models-preview.sh "Add user notification preferences"
./scripts/gh-models-preview.sh "Document the payments service" --template service-documentation
./scripts/gh-models-preview.sh "Migrate auth" --template tech-migration --context "Using session cookies"
./scripts/gh-models-preview.sh "Add feature X" --model openai/gpt-4.1
```

```powershell
.\scripts\gh-models-preview.ps1 -Description "Add user notification preferences"
.\scripts\gh-models-preview.ps1 -Description "Document payments" -Template service-documentation
```

#### Claude Code CLI (`claude`)

Uses the `claude` CLI directly. Uses your Claude Code default model (e.g., `claude-opus-4-6`).

```bash
./scripts/cli-preview.sh "Add user notification preferences"
./scripts/cli-preview.sh "Document the payments service" --template service-documentation
./scripts/cli-preview.sh "Migrate auth" --template tech-migration --context "Using session cookies"
./scripts/cli-preview.sh "Add feature X" --model claude-opus-4-6
```

```powershell
.\scripts\cli-preview.ps1 -Description "Add user notification preferences"
.\scripts\cli-preview.ps1 -Description "Document payments" -Template service-documentation
```

Both output to `preview/` as `.md` + `.json`. Push to Confluence after reviewing:

```bash
./scripts/push-to-confluence.sh preview/20260324-143022-user-notifications.json
./scripts/push-to-confluence.sh preview/20260324-143022-user-notifications.json --jira
```

---

### n8n Workflows (Docker, browser UI, auto-publish)

#### Preview First (Recommended for getting started)

```bash
./scripts/trigger-preview.sh "Add user notification preferences"
# → preview/20260324-143022-user-notifications.md   (review this)
# → preview/20260324-143022-user-notifications.json  (push when ready)

./scripts/push-to-confluence.sh preview/20260324-143022-user-notifications.json --jira
```

Workflow: `workflows/preview-pipeline.json`

#### Direct Push (one-step Confluence + Jira)

```bash
./scripts/trigger-analysis.sh "Add feature X"
./scripts/trigger-analysis.sh "Add feature X" --no-jira
./scripts/trigger-analysis.sh "Add feature X" --context "We use PostgreSQL"
```

Workflow: `workflows/github-models-pipeline.json` (free) or `workflows/technical-analysis-pipeline.json` (Anthropic, paid).

There are also n8n workflow variants for both CLIs (`workflows/cli-preview-pipeline.json` and `workflows/gh-models-cli-pipeline.json`) — these use the Execute Command node and only work with native n8n (not Docker).

#### Iterative Preview (auto-critique + human feedback loop)

AI generates → self-critiques → refines automatically (3 passes), then you can provide feedback for further refinement. Select "Iterative Preview" in the `trigger.html` dropdown, or call the webhook directly.

```bash
# Takes 45-120 seconds (3 AI passes)
curl -X POST http://localhost:10353/webhook/preview-iterative \
  -H "Content-Type: application/json" \
  -d '{"featureDescription": "Add notifications", "template": "new-feature"}'
```

Workflow: `workflows/iterative-preview-pipeline.json`. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md#iterative-preview-pipeline) for full details.

---

### Markdown → Jira / Confluence (no AI needed)

Publish your own markdown files directly to Jira or Confluence — no AI, no n8n.

```bash
# Create Jira Epic + linked Stories from markdown files
./scripts/folder-to-jira.sh \
  --epic my-project/epic.md \
  --task my-project/task-api.md \
  --task my-project/task-db.md \
  --task my-project/task-ui.md

# Create Confluence page from markdown files
./scripts/folder-to-confluence.sh \
  --page docs/overview.md \
  --section docs/setup.md \
  --section docs/api-reference.md

# Preview first (no tickets/pages created)
./scripts/folder-to-jira.sh --epic epic.md --task task-*.md --dry-run
./scripts/folder-to-confluence.sh --page docs/overview.md --dry-run
```

```powershell
.\scripts\folder-to-jira.ps1 -Epic epic.md -Tasks task-api.md,task-db.md
.\scripts\folder-to-confluence.ps1 -Page docs\overview.md -Sections docs\setup.md,docs\api.md
```

See [docs/WORKFLOWS.md](docs/WORKFLOWS.md#folder-to-jira) for markdown format and all options. Example files in `examples/epic-folder/` and `examples/confluence-folder/`.

## Team Context Profiles

Inject your team's tech stack, conventions, and project management config into every prompt. This makes AI output specific to your environment instead of generic.

```bash
# Copy the example and customize
cp team-profiles/example.json team-profiles/my-team.json
```

The profile includes your stack, API conventions, estimation scales, Jira config, Confluence spaces, and service inventory. See [team-profiles/example.json](team-profiles/example.json) for the full structure and [team-profiles/profile.schema.json](team-profiles/profile.schema.json) for the schema.

> **Status:** Profile schema and examples are ready. Automatic injection into n8n prompts is the next development step — for now, copy relevant sections from your profile into the `additionalContext` field when triggering.

## Customization

See [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for:
- Writing custom prompt templates
- Injecting your tech stack context
- Confluence page formatting and macros
- Jira custom fields, epic linking, sprint assignment
- Adding Slack notifications
- Batch processing multiple features

## Requirements

- Docker & Docker Compose
- Confluence Cloud + API token
- Jira Cloud + API token (optional)
- **AI provider (choose one — see table below)**

### AI Provider Options

You do NOT need a paid API key. GitHub Models API is free with any GitHub account.

| Provider | Cost | What You Need | Best For |
|----------|------|---------------|----------|
| **GitHub Models API** | **Free** (rate-limited) | GitHub account + Personal Access Token | Getting started, low volume |
| GitHub Models + Copilot | Copilot subscription ($10-39/mo) | Higher rate limits than free tier | Regular use |
| Anthropic API | Pay-per-use (~$3-15/MTok) | API key from console.anthropic.com | High volume, best quality |
| OpenAI API | Pay-per-use (~$2.50-10/MTok) | API key from platform.openai.com | High volume, alternative |

**Recommended starting point:** CLI scripts (no setup) or GitHub Models API (free) with `openai/gpt-4.1`. See [docs/CLI_SETUP.md](docs/CLI_SETUP.md) or [docs/GITHUB_MODELS_SETUP.md](docs/GITHUB_MODELS_SETUP.md).

## FAQ

**Can I use this without paying for anything?**
Yes, multiple ways:
- **CLI scripts** with `claude` CLI (if you have Claude Code) or `gh models` (free GitHub account) — no API keys, no Docker
- **n8n workflows** with GitHub Models API (free, rate-limited to ~50-150 req/day) — needs Docker but no API keys

**Can I use this without Docker?**
Yes. Use the standalone CLI scripts (`scripts/cli-preview.sh` or `scripts/gh-models-preview.sh`). They call the AI directly from your terminal. See [docs/CLI_SETUP.md](docs/CLI_SETUP.md).

**Can I use my Copilot subscription?**
Yes! Install `gh extension install github/gh-models` and use `scripts/gh-models-preview.sh`. This runs models from the GitHub Models marketplace using your existing `gh` authentication. Copilot subscribers get higher rate limits. See [docs/CLI_SETUP.md](docs/CLI_SETUP.md#option-a-github-copilot-cli-gh-models).

**Can I use Claude via GitHub Models (free)?**
Claude models (`anthropic/claude-4-opus`, `anthropic/claude-4-sonnet`) are listed on GitHub Models but did not work reliably in our testing via the REST API. However, they may work via the `gh models run` CLI. If you want reliable Claude, use the Claude Code CLI (`scripts/cli-preview.sh`) or the Anthropic API directly.

**Can I use OpenAI instead of Claude?**
Yes. For n8n workflows: change `AI_MODEL=gpt-4o` in `.env`. For CLI: `./scripts/gh-models-preview.sh "..." --model openai/gpt-4.1`.

**Does this work with Confluence Server (on-premise)?**
Yes, but the API endpoints differ slightly. Confluence Server uses `/rest/api/content` without the `/wiki` prefix. Update the URL in the n8n node.

**Can I use this without Jira?**
Yes. Pass `createJiraTasks: false` or use the `--no-jira` flag. You'll still get the Confluence page.

**Can I run this without Docker?**
Yes. Install n8n globally with `npm install -g n8n`, then `n8n start`. Import the workflow the same way.

**Is n8n free?**
Yes, for self-hosted use. n8n uses a "fair-code" license (Sustainable Use License) — free to self-host internally with no user, workflow, or execution limits. You only need a paid license if you resell it or offer it as a hosted service. For running this pipeline on your own machine or your company's server, it's completely free. If your company has strict OSS-only policies, see [Alternatives to n8n](#alternatives-to-n8n) below.

**How do I add this to a CI/CD pipeline?**
Trigger the webhook from your CI — e.g., when a specific label is added to a GitHub issue, a GitHub Action calls the webhook with the issue body.

### Alternatives to n8n

If you need a fully open-source alternative or prefer a different tool:

| Tool | License | Notes |
|------|---------|-------|
| **n8n** (used here) | Fair-code (free self-hosted) | Best UI, most integrations, easiest setup |
| **Activepieces** | MIT | Fully open-source, similar visual workflow builder |
| **Windmill** | AGPLv3 | More developer-focused, script-based workflows |
| **Plain scripts** | N/A | The prompt templates and API calls work without any workflow tool — just use the trigger scripts directly |

The workflow JSON, prompt templates, and trigger scripts in this repo are all MIT-licensed regardless of which orchestration tool you use.

## Roadmap

See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the full roadmap.

**Done:**
- 13 prompt templates across 3 categories (full-pipeline, confluence-only, jira-only)
- Template registry with JSON Schema validation
- Team context profiles with schema and example
- **`acp` CLI + MCP server** — publish agent/hand-written markdown to Jira & Confluence (Stage 1: via n8n publish webhooks). See **[Install guide](docs/INSTALL.md)** · **[CLI & MCP guide](docs/CLI_AND_MCP.md)** · **[ready-to-use setup prompt](docs/SETUP_PROMPT.md)**.
- **Browser UI workbench** — reusable templates, named sessions, a rolling 10-deep auto-history, undo/redo, and multi-tab-safe shared storage (independent tabs, shared library). See **[Workbench guide](docs/SESSIONS.md)**.

**Next up:**
- **Template routing in n8n** — wire the registry so `--template` flag selects the right prompt and output routing
- **Confluence page templates** — polished layouts with macros, panels, and TOC per template type
- **Jira structure support** — epic-with-stories, phased-epics, story-with-subtasks in n8n
- **Smart template selection** — AI auto-detects the best template from the description
- **Direct-REST backend** — `ACP_BACKEND=direct` so the CLI/MCP skip n8n (Stage 2)
- **`acp analyze`** — AI generation via the CLI (currently the agent generates; tool publishes)

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

The [template registry](templates/registry.json) is the easiest place to start — even adding a single new template helps. See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the priority list and [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for how templates work.

## License

MIT — see [LICENSE](LICENSE).
