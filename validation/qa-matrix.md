# QA Matrix — status-provider config.json

Tracked, versioned enumeration of every field in `StatusProviderConfig`
(`src/lib/types.ts`), grouped into execution batches. Each batch is a single
`Task()` invocation of `status-provider-tui-test-orchestrator`, which either
delegates to `status-provider-tui-test-simple` / `status-provider-tui-test-complex`
(wizard-driven fields) or validates directly via `agent-browser` (direct-edit
fields with no wizard prompt).

**Scope of this round: sidebar only.** Toast-only fields are enumerated in
Batch F for completeness but deferred to a future session (see
`04-Decisiones.md` in the Obsidian vault for the reasoning).

## How to run a batch

1. Confirm the sandbox is up: `podman ps --filter name=status-provider-validation`.
   If not running: `./validation/run.sh` from the repo root (do NOT `--build`
   unless the Containerfile changed).
2. Dispatch: `Task(subagent_type: "status-provider-tui-test-orchestrator", prompt: "Run Batch <LETTER> from validation/qa-matrix.md against sandbox port 3002.")`
3. The orchestrator updates the `Status` column below for every row in that
   batch and returns a compact summary. It does **not** proceed to the next
   batch automatically.
4. After each batch: review the summary, checkpoint progress in the Obsidian
   vault (`01-Projects/OpenCode-Status-Provider/`), then stop or continue.

## Status legend

`pending` · `pass` · `fail` · `blocked` · `deferred`

---

## Batch A — Sidebar visual variants (wizard-driven → `status-provider-tui-test-simple`)

| Field | Type | Values to test | Default | Status |
|---|---|---|---|---|
| `formatStyle` | select | `allWindows` | `singleWindow` | pending |
| `percentDisplayMode` | select | `used` | `remaining` | pending |
| `textVariant` | select | `minimal`, `box`, `emoji` | `default` | pending |
| `providerNameVariant` | select | `short`, `icon` | `full` | pending |
| `percentVariant` | select | `number`, `bar` | `both` | pending |
| `colorVariant` | select | `auto` | `none` | pending |
| `alignmentVariant` | select | `right` | `left` | pending |

Evidence: sidebar `Status` block after launching `opencode` (option 1) inside
an active session. Do not trigger a real chat turn — use `/status-provider`
for a second, independent rendering surface if the sidebar alone is
ambiguous.

## Batch B — Sidebar wizard toggles (wizard-driven → `status-provider-tui-test-simple`)

| Field | Type | Values to test | Default | Status |
|---|---|---|---|---|
| `showSessionTokens` | confirm | `false` | `true` | pending |
| `onlyCurrentModel` | confirm | `true` | `false` | pending |
| `debug` | confirm | `true` | `false` | pending |

Evidence: same as Batch A. `debug=true` should add a debug footer;
`showSessionTokens=false` should remove the session tokens section;
`onlyCurrentModel=true` should narrow the sidebar to the active model's
provider only.

## Batch C — Master switches + provider/data fields (direct-edit → orchestrator validates directly)

No wizard prompt exists for these. The orchestrator writes
`validation/sandbox-state/.config/opencode/status-provider/config.json`
directly (via `bash`/`edit`), then opens the sandbox itself to confirm.

| Field | Type | Values to test | Default | Status |
|---|---|---|---|---|
| `enabled` | bool | `false` | `true` | pending |
| `tuiSidebarPanel.enabled` | bool | `false` | `true` | pending |
| `anthropicBinaryPath` | string | `"nonexistent-binary"` (invalid path) | `"claude"` | pending |
| `googleModels` | array | `["G3FLASH"]` | `["CLAUDE"]` | pending |
| `alibabaCodingPlanTier` | enum | `"pro"` | `"lite"` | pending |
| `cursorPlan` | enum | `"pro"` | `"none"` | pending |
| `opencodeGoWindows` | array | `["weekly"]` | `["rolling","weekly","monthly"]` | pending |
| `cursorIncludedApiUsd` | number? | `50` | unset | pending |
| `cursorBillingCycleStartDay` | number? | `15` | unset | pending |
| `pricingSnapshot.source` | enum | `"bundled"` | `"auto"` | pending |
| `pricingSnapshot.autoRefresh` | number | `0` | `7` | pending |
| `requestTimeoutMs` | number | `100` (aggressively short) | `5000` | pending |

Evidence: `enabled=false` and `tuiSidebarPanel.enabled=false` must make the
`Status` block disappear from the sidebar entirely (no crash, no empty
frame). Provider-specific fields (`googleModels`, `cursorPlan`,
`alibabaCodingPlanTier`, `anthropicBinaryPath`) may render as "unavailable"
if the sandbox lacks that provider's auth — that is expected and fine; the
bar is **no crash, no unhandled exception, no frozen TUI**, not "real data."
`requestTimeoutMs=100` must degrade gracefully (timeout/error entry), never
hang the sidebar.

## Batch D — TUI compact status surface (direct-edit → orchestrator validates directly)

Separate UI surface from the sidebar panel (home-bottom / session-prompt
compact line), still part of the TUI.

| Field | Type | Values to test | Default | Status |
|---|---|---|---|---|
| `tuiCompactStatus.enabled` | bool | `true` | `false` | pending |
| `tuiCompactStatus.homeBottom` | bool | `false` (with `enabled: true`) | `true` | pending |
| `tuiCompactStatus.sessionPrompt` | bool | `false` (with `enabled: true`) | `true` | pending |
| `tuiCompactStatus.suppressWhenNativeProviderStatus` | bool | `false` | `true` | pending |
| `tuiCompactStatus.maxWidth` | number | `40` (narrow) | `96` | pending |

Evidence: compact status line at the bottom of the home screen and/or beside
the session prompt (only visible once `tuiCompactStatus.enabled: true`).

## Batch E — Combinatorial provider selection (wizard-driven → `status-provider-tui-test-complex`, model `kimi-for-coding/k2p7`)

| Fields | Scenario | Status |
|---|---|---|
| `enabledProviders` + `providerOrder` | Switch to manual list (pick 2 of the available sandbox providers), then set a custom order different from registry default. Verify both selection AND order persist and match `/status-provider` output ordering and the sidebar ordering. | pending |

---

## Batch F — DEFERRED (toast-only fields, future session)

Not executed this round. Listed for completeness so the full config schema
is accounted for (44 leaf fields total, 29 in Batches A–E, 15 here).

| Field | Type | Notes |
|---|---|---|
| `enableToast` | bool | Only observable via toast popups. |
| `minIntervalMs` | number | Numeric edge cases (0, negative, huge). |
| `toastDurationMs` | number | Numeric edge cases. |
| `toastTextVariant` | select | Requires `copyFromSidebar=false` branch. |
| `toastProviderNameVariant` | select | Requires `copyFromSidebar=false` branch. |
| `toastPercentVariant` | select | Requires `copyFromSidebar=false` branch. |
| `toastColorVariant` | select | Requires `copyFromSidebar=false` branch. |
| `toastAlignmentVariant` | select | Requires `copyFromSidebar=false` branch. |
| `showOnIdle` | bool | Toast trigger condition. |
| `showOnQuestion` | bool | Toast trigger condition. |
| `showOnCompact` | bool | Toast trigger condition. |
| `showOnBothFail` | bool | Toast trigger condition. |
| `layout.maxWidth` | number | Comment in `types.ts`: "not used by the fixed-width TUI sidebar" — toast-only. |
| `layout.narrowAt` | number | Toast-only. |
| `layout.tinyAt` | number | Toast-only. |

Also revisit in that session: full per-value toast parity vs. wiring-only
validation via `copyFromSidebar` true/false branches (decision pending from
the sidebar round).

---

## Timing notes (measured empirically, 2026-07-08 sandbox session)

- Container already up: reuse across the whole batch, do not rebuild/restart
  between fields — only `validation/sandbox-state/.../config.json` needs to
  change.
- Reset between individual field tests: overwrite `config.json` with `{}`
  (merges to `DEFAULT_CONFIG`) or the batch's known baseline — cheaper than a
  container restart.
- **Never trigger a real chat turn** (free-text prompt) to observe the
  sidebar/toast. LLM providers can enter unpredictable retry loops (observed:
  10–30s+ hangs, "gemini is way too hot"). Use `/status-provider` (slash
  command, deterministic, no model call) and the sidebar panel, which
  populates from provider status calls, not chat completions.
- Estimated wall-clock: Batch A ≈ 15–25 min, Batch B ≈ 8–12 min, Batch C ≈
  10–15 min (no subagent spend, orchestrator-direct), Batch D ≈ 8–10 min,
  Batch E ≈ 5–10 min. Full round (A–E) ≈ 45–70 min sequential.
