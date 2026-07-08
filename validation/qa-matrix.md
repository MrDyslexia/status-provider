# QA Matrix — status-provider config.json

Lightweight, deterministic validation for the sidebar visual fields of
`StatusProviderConfig`.

The old approach ran one browser-wizard test per field and was taking hours
without finishing. The sidebar rendering is pure string formatting
(`buildSidebarStatusPanelLines` → `formatStatusRows`), so every visual variant
is now validated with fast unit tests and snapshots.

## Source of truth

`tests/sidebar-config-variants.test.ts` exercises every sidebar visual field
with synthetic `StatusRenderData`. Snapshots live in
`tests/__snapshots__/sidebar-config-variants.test.ts.snap`.

## Run it

```sh
bun run test tests/sidebar-config-variants.test.ts
```

Wall-clock: ~100 ms.

## Sidebar visual fields covered

| Field | Values tested | Default | Validation |
|---|---|---|---|
| `formatStyle` | `singleWindow`, `allWindows` | `singleWindow` | Snapshot + assertions |
| `percentDisplayMode` | `remaining`, `used` | `remaining` | Contains assertions |
| `textVariant` | `default`, `minimal`, `box`, `emoji` | `default` | Snapshot + assertions |
| `providerNameVariant` | `full`, `short`, `icon` | `full` | Snapshot + assertions |
| `percentVariant` | `number`, `bar`, `both` | `both` | Snapshot + assertions |
| `colorVariant` | `auto`, `none` | `none` | Asserts no visible difference in sidebar (ANSI stripped) |
| `alignmentVariant` | `left`, `right` | `left` | Only affects `minimal` rows; snapshot + assertions |

## Notes

- `colorVariant` has no visible effect in the sidebar because
  `buildSidebarStatusPanelLines` strips ANSI codes; the sidebar uses a single
  theme color. It still affects toast and CLI output.
- `alignmentVariant` only changes layout when `textVariant` is `minimal`;
  other text variants ignore it.
- `bar` and `both` currently produce identical output for the sidebar.

## Remaining fields covered by existing or new tests

| Field | Where it is validated |
|---|---|
| `showSessionTokens` | `tests/sidebar-config-toggles.test.ts` |
| `onlyCurrentModel` | `tests/status-render-data.test.ts`, `tests/tui-runtime.test.ts` |
| `enabled` | `tests/sidebar-config-toggles.test.ts` |
| `tuiSidebarPanel.enabled` | `tests/sidebar-config-toggles.test.ts`, `tests/tui-runtime.test.ts` |
| `enabledProviders` | `tests/sidebar-config-toggles.test.ts`, `tests/status-render-data.test.ts` |
| `providerOrder` | `tests/providers.registry.test.ts`, `tests/sidebar-config-toggles.test.ts` |
| `tuiCompactStatus.*` | `tests/tui-runtime.test.ts`, `tests/tui-compact-format.test.ts` |
| Provider/data fields (`anthropicBinaryPath`, `googleModels`, `alibabaCodingPlanTier`, `cursorPlan`, `opencodeGoWindows`, `cursorIncludedApiUsd`, `cursorBillingCycleStartDay`, `pricingSnapshot.*`, `requestTimeoutMs`) | Provider-specific tests in `tests/providers.*`, `tests/lib.config.test.ts`, `tests/lib.config.integration.test.ts` |

## Still toast-only / deferred

Fields that cannot be validated through the sidebar formatter or runtime wiring:

| Field | Reason |
|---|---|
| `enableToast` | Toast popup trigger |
| `minIntervalMs` / `toastDurationMs` | Timing behavior |
| `toast*` variants | Toast-only surface |
| `showOnIdle` / `showOnQuestion` / `showOnCompact` / `showOnBothFail` | Toast trigger conditions |
| `layout.*` | Toast layout only |
