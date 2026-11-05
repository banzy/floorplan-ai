# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Floorplan (plugin name `floorplan-ai`) is a Claude Code / Codex plugin that maps a codebase as an interactive node-graph, saved as `floorplan/index.html` in the *target* project. This repo is the plugin itself: a skill (`skills/floorplan-ai/`), plain Node.js scripts, and a browser viewer. **Zero dependencies, Node 18+** — nothing to install, and nothing may be added.

## Commands

```bash
npm test                              # = node --test (Node's built-in runner)
node --test tests/health.test.mjs     # a single test file
node --test --test-name-pattern="substring" tests/ai.test.mjs   # a single test by name

# Run the pipeline by hand against any project
node skills/floorplan-ai/scripts/scan.mjs /path/to/project
node skills/floorplan-ai/scripts/build.mjs /path/to/project   # needs floorplan/architecture.json (see references/schema.md)
node skills/floorplan-ai/scripts/open.mjs /path/to/project

claude plugin validate .                          # before PRs
claude plugin validate . --profile directory      # before releases
```

There is no linter or build step. A plugin installed from a local folder (`claude plugin marketplace add /path/to/floorplan`, then `claude plugin install floorplan-ai@floorplan-ai`) runs straight from the working copy.

## Architecture

Work is split between **scripts** (mechanical, free) and **the AI agent running the skill** (judgment). `skills/floorplan-ai/SKILL.md` is the workflow the agent follows; `references/*.md` are the formats and style guides it reads (`schema.md` defines `architecture.json` / `recent-work.json`, `blueprint.md` defines `plan.json`).

Pipeline (all in `skills/floorplan-ai/scripts/`):
`status` → `scan` (repos, files, imports, endpoints, web requests → `.cache/scan.json`) → agent writes `architecture.json` → `build` (validate, assign files to the deepest matching part, connect request→endpoint, Health, screens, AI layer → `graph.json` + `index.html`) → `describe` (worksheets the agent fills with names/descriptions) → `recent` → `open`. `refresh` is the incremental path (re-scan, carry over unchanged descriptions via fingerprints). `plan.mjs` is the blueprint path: a PRD-derived `plan.json` produces the same `scan.json` so the rest of the pipeline is shared.

- `scripts/lib/`: `extract.mjs` (per-language/framework parsing), `resolve.mjs` (import resolution), `routes.mjs` (matching requests to endpoints, incl. cross-repo and prefix handling), `health.mjs` (security checks; the largest file), `screens.mjs`, `ai.mjs` (AI-usage view), `blueprint.mjs`, `agent.mjs` (detects whether Claude Code or Codex is running), `common.mjs` (globs, flags, helpers).
- `assets/viewer.html` is a template the build fills in; `assets/ui/*.js` are viewer extensions **inlined in filename order** and may only touch the viewer through `window.Floorplan`. Code there must work in an exported copy (`Floorplan.exported`), so anything needing the server or an agent must be gated.
- `assets/serve.mjs` and `assets/query-cli.mjs` are **copied into each target project's `floorplan/` folder**; `serve.mjs` answers "Ask the map" by shelling out to Claude Code or Codex (`ENGINES` table), 127.0.0.1 only, read-only enforced by the CLI itself. The command to run must never come from the page or saved settings.
- `graph-query.js` is shared by the viewer, `query.mjs`, and Ask prompts.
- Two parallel plugin manifests (`.claude-plugin/`, `.codex-plugin/`) point at the same skill and must share a version.

## Rules that tests enforce

- `supply-chain.test.mjs` pins what the plugin may do (no hooks, MCP servers or dependencies, one outbound request, fixed program list, no run-time code loading, vendored `elk.bundled.js` unchanged). Changing capabilities means updating `docs/is-it-safe.md` to match.
- `release.test.mjs` requires the version to agree across both `plugin.json` files, the README badge, `CHANGELOG.md` and `CHECKSUMS.txt`.
- Health findings record location plus a masked hint, **never a secret value**. Test secrets are assembled at runtime in tests; never commit a real-looking key.
- When fixing a detection bug, add a sample (via `tests/helpers.mjs` `shopApp()` or `tests/fixtures/`) and confirm the test fails without the fix. Agent CLIs are faked in `tests/fixtures/fake-cli/`.
- Anything the map shows should be plain language for an app's owner, not an engineer. Keep examples generic; never describe a real private project.

## Workflow

- Branch from `main` (`fix/<issue>-name`, `feat/name`, `docs/…`, `chore/…`); merge with `--no-ff`. Commit summaries are imperative; the body says why.
- User-visible changes add a line under `## Unreleased` in `CHANGELOG.md`.
- Release: bump version in both `plugin.json` files and the README badge, rename Unreleased in the changelog, run `node tools/checksums.mjs` *after* the bump (rewrites `CHECKSUMS.txt`), then tag with `claude plugin tag . -m "Floorplan %s" --push`. Full steps in `docs/development.md`.
- Adding an agent: an entry in `DETECT` in `scripts/lib/agent.mjs` (who built the map) and/or `ENGINES` in `assets/serve.mjs` (who answers questions), plus a fake CLI and tests like `ask.test.mjs`.
