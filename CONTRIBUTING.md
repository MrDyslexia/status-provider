# Contributing to status-provider

Thanks for contributing. This repo has strict local-only behavior and regression guardrails, so please follow this workflow.

## Issue-First (Preferred)

- Prefer opening an issue before starting features, bug fixes, refactors, or behavioral changes.
- If you already have a fix ready, opening an issue and PR together is fine.
- When an issue exists, link it in the PR description using `Fixes #<issue>` or `Refs #<issue>`.
- If no issue exists, include a short rationale/scope summary in the PR description.

## Issue and PR Templates

- GitHub Issue Forms are enabled and blank issues are disabled.
- Use `.github/ISSUE_TEMPLATE/bug_report.yml` for bug reports.
- Use `.github/ISSUE_TEMPLATE/feature_request.yml` for feature requests.
- Use template title prefixes for consistent issue titles.
- Inactive issues may be marked stale after 23 days and closed 7 days later if there are still no updates.
- Bug title format: `[bug]: <short description>`
- Feature title format: `[feature]: <short description>`
- Pull requests use `.github/pull_request_template.md` and should include tested OpenCode version details.

## Development Setup

- The published package runtime supports Node.js `>=18.0.0` (matches `package.json` engines).
- Repository development uses Bun `1.3.4` (matches `package.json#packageManager`).
- Direct dependencies are pinned to exact versions in `package.json`; run `bun install` after dependency changes so `bun.lock` records the same exact specs.
- Install dependencies with:

```sh
bun install
```

`bun install` runs `prepare`, which installs Husky hooks.

## Local Quality Gates

Pre-commit hooks currently run:

- `bunx lint-staged` (formats staged files via Prettier)
- `bun run typecheck`
- `bun run test`

Pre-push hooks currently run:

- `bun install --frozen-lockfile`

Run checks manually before opening a PR:

```sh
bun run typecheck
bun run test
bun run build
```

Use `bun run test:watch` for local iteration. Use `bun run build:check` when you need the build plus package dry-run check.

## CI Checks (Automated)

PR and `main` pushes trigger `.github/workflows/ci.yml` (`CI` workflow):

- Job: `bun-quality`
- Steps: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun run test`, `bun pm pack`
- Job: `runtime-smoke` on Node `18.x`, `20.x`, and `22.x`
- Runtime smoke installs the packed package as a consumer with npm and verifies the exported server entrypoints plus `engines.node >=18.0.0`

Release workflow `.github/workflows/publish-npm.yml` runs on release/manual dispatch and uses Bun for version verification, install, typecheck, build, and test before publishing. It keeps `npm publish --access public` only for the npm registry publish step.

## Branch Protection (Maintainers)

Recommended settings for `main`:

- Require a pull request before merging.
- Require branches to be up to date before merging.
- Require status checks from workflow `CI` for `bun-quality` and every `runtime-smoke` matrix entry.
- Select checks exactly as GitHub displays them in repository settings.
- Typical names look like `bun-quality`, `runtime-smoke (18.x)`, `runtime-smoke (20.x)`, `runtime-smoke (22.x)` or `CI / ...` variants.
- Block direct pushes to `main` for non-admin users.

## Repo Guardrails

- Never invoke an LLM/model API to compute toast/report output. Everything must remain local and deterministic.
- Preserve slash command handled-sentinel behavior in `command.execute.before`.
- Do not catch `isCommandHandledError(...)` and return normally.
- Keep `tests/plugin.command-handled-boundary.test.ts` aligned with this invariant.

Additional boundary tests to keep healthy when touching plugin/provider logic:

- `tests/plugin.qwen-hook.test.ts`
- `tests/status-provider-boundary.test.ts`

## Provider Changes

When adding a provider, keep the README setup wording tied to real behavior.

- For API-key/token providers that support `Existing OpenCode auth, global config, or env`, start from `contributing/provider-template/`.
- Copy the template files to the target paths listed in `contributing/provider-template/README.md`.
- Replace the example names, ids, env vars, and config keys before coding.
- Add tests for each supported auth source before using the shared README wording; do not leave copied template tests skipped, todo-only, or unresolved.
- In the PR checklist, state whether you started from the provider template; if not, explain why it does not apply.
- Do not use that wording for OAuth-only providers such as OpenAI.

## Validation Sandbox (TUI plugin loading)

- Pinned validation environment:
  - Bun: `1.3.4` (`package.json#packageManager`, CI setup)
  - OpenCode CLI: `1.17.9` (`validation/Containerfile#OPENCODE_CLI_VERSION`)
  - OpenCode plugin SDK: `@opencode-ai/plugin@1.17.9` (`package.json` dependency and peer)
- `validation/Containerfile` pins the `opencode` CLI to a specific version (`OPENCODE_CLI_VERSION` build arg, default `1.17.9`) instead of trusting whatever the base image has baked in. `opencode` auto-updates itself on launch by default, which can silently drift the sandbox forward to an incompatible version.
- `validation/opencode.template.json` is the tracked source of truth for the sandbox's `opencode.json`; `validation/tui.template.json` is the tracked source of truth for `tui.json`. `run.sh` copies both into `sandbox-state/.config/opencode/` on every run (that path itself is gitignored, since it's runtime state).
- Three things in the templates matter and must not regress:
  - `"autoupdate": false` — stops opencode from upgrading itself past the pinned CLI version.
  - `opencode.json` must include `"plugin": ["file:///project"]` so server-side slash commands load.
  - `tui.json` must include `"plugin": ["file:///project"]` so the TUI/sidebar plugin loads. Both paths must reference the **package directory**, not individual files like `file:///project/dist/tui.js`. opencode resolves the `server` and `tui` plugin entrypoints independently via `package.json`'s `exports["./server"]` / `exports["./tui"]`. Pointing at a raw file bypasses that resolution and opencode's `server`-kind loader tries to load the `tui`-only file too, which throws `must default export an object with server()`.
- When bumping `OPENCODE_CLI_VERSION`, also bump `peerDependencies["@opencode-ai/plugin"]` in `package.json` to match, rebuild the sandbox image, and re-verify the TUI sidebar panel actually renders (not just that it loads without error) before merging.

## Quality Bar for Fixes

- Prefer the smallest safe fix that addresses the root cause.
- Align behavior with current OpenCode production behavior rather than adding extra hook/output mutation layers.
- Preserve existing invariants and update/add boundary tests when behavior contracts change.
- We appreciate PRs that verify the fix against the current production released OpenCode version and note the tested version in the PR.

## Pull Request Checklist

- Linked issue (`Fixes #...` or `Refs #...`) when available, or included a short no-issue rationale in the PR.
- `bun run typecheck` passes.
- `bun run test` passes.
- `bun run build` passes.
- Verified behavior against the current production released OpenCode version, and included the tested version in the PR notes.
- Updated docs when user-facing commands/config/workflow changed (usually `README.md`; update this file when contributor workflow changes).
- For new API-key/token providers, started from `contributing/provider-template/` or explained why the template does not apply.
- For provider setup/auth wording changes, checked `contributing/provider-template/` and verified README wording against implementation/tests.
