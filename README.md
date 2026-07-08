# status-provider

OpenCode plugin and CLI for provider usage status across AI providers.

`status-provider` renders provider quota/status windows in OpenCode popups, TUI sidebar panels, compact status surfaces, slash commands, and CLI output. It supports configurable provider ordering, display variants, session token summaries, pricing diagnostics, and provider-specific availability checks.

## Status

Initial independent release line: `0.1.x`.

This project is a clean-history successor derived from prior fork work, but it is maintained as an independent project with its own package identity, config path, commands, docs, and release policy.

## First Steps

### Local install

```bash
bun install
bun run build
```

### Quick config

```bash
status-provider config
```

### Inside container

Use this when working from `plugin-status-provider`:

```bash
bun /plugin/status-provider/dist/bin/status-provider.js config
```

## CLI

```bash
status-provider --help
status-provider init
status-provider show
status-provider config
status-provider config --dry-run
```

## OpenCode Commands

- `/status-provider` — provider status output injected into chat
- `/status-provider-toast` — force-show the actual popup toast right now, bypassing cache/interval
- `/status-provider-info` — diagnostics, pricing, config paths, and provider availability

## Config

Primary config path:

```text
<config-root>/status-provider/config.json
```

`config-root` follows OpenCode config resolution. If `OPENCODE_CONFIG_DIR` is set, that directory is used as the root.

Example:

```json
{
  "enabledProviders": "auto",
  "formatStyle": "allWindows",
  "percentDisplayMode": "used",
  "textVariant": "default",
  "providerNameVariant": "full",
  "percentVariant": "both",
  "colorVariant": "none",
  "alignmentVariant": "left",
  "toastTextVariant": "default",
  "toastProviderNameVariant": "full",
  "toastPercentVariant": "both",
  "toastColorVariant": "none",
  "toastAlignmentVariant": "left",
  "tuiSidebarPanel": {
    "enabled": true
  }
}
```

`textVariant`/`providerNameVariant`/`percentVariant`/`colorVariant`/`alignmentVariant` control the TUI sidebar panel and the `/status-provider` CLI/slash command output. The `toast*` counterparts control popup toasts independently — `status-provider config` can copy the sidebar choices as a starting point for the toast section, or configure it from scratch.

Clean-start policy: `status-provider` does not migrate legacy config automatically.

## Development

```bash
bun run typecheck
bun run build
bun run test
```

Tests run through Vitest via `bun run test`; do not use Bun's built-in test runner for this suite.

## Publishing Readiness

The package is prepared for future npm/Bun publication as `status-provider`, with a single binary named `status-provider`.

## License

MIT
