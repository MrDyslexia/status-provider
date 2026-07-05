# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)
1. **[2026-07-04] Full suite currently includes legacy rename failures**
   Do instead: validate changes with `bun run typecheck`, `bun run build`, `bun pm pack --dry-run`, focused tests first, then clean legacy tests toward full suite.
2. **[2026-07-04] Validation sandbox is local-only state**
   Do instead: keep `validation/sandbox-state/` ignored and validate container behavior through `validation/run.sh` or `podman exec`.

## Domain Behavior Guardrails
1. **[2026-07-04] Status-provider has clean config only**
   Do instead: read/write `<config-root>/status-provider/config.json`; do not reintroduce `experimental.statusProvider` seed/sync unless user explicitly changes policy.
2. **[2026-07-04] OpenCode filenames may be legitimate**
   Do instead: preserve `opencode-*` names when they refer to OpenCode platform/provider integration, not old package identity.

## Release & Repository
1. **[2026-07-04] Project identity is independent**
   Do instead: keep public identity as `status-provider` version `0.1.0`, with lineage documented in `LINEAGE.md` and no fork branding.
