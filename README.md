# status-provider

```text
   ┌──────────────────────────────────────┐
   │            status-provider            │
   │   quota gauges for your AI providers  │
   └──────────────────────────────────────┘
        Copilot   [██████████    ]  72%
        OpenAI    [███████       ]  54%
        Google    [███           ]  23%
             — right inside OpenCode —
```

OpenCode plugin and CLI that shows how much quota/usage you have left across
**18 AI providers** — without leaving the terminal.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

## Table of contents

- [What is this for?](#what-is-this-for)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Visual examples](#visual-examples)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [OpenCode slash commands](#opencode-slash-commands)
- [Supported providers](#supported-providers)
- [Development](#development)
- [Contributing](#contributing)
- [Status & lineage](#status--lineage)
- [Publishing readiness](#publishing-readiness)
- [License](#license)

## What is this for?

If you use OpenCode across several AI providers — Anthropic, Copilot, OpenAI,
Google, Cursor, Qwen, MiniMax, Kimi, and a dozen others — you eventually hit
the same annoying problem: **you don't know how much quota you have left
until a request fails.** Rate limits and coding-plan windows reset on
different schedules per provider, and checking each provider's own dashboard
means leaving your terminal, switching tabs, and losing flow.

`status-provider` solves this by pulling usage/quota data for every provider
you have configured and rendering it directly inside OpenCode, in three
surfaces:

- **Popup toasts** — a status window that pops up automatically (on idle,
  after a question, after compaction, or after both providers fail), so you
  see your remaining quota without asking for it.
- **TUI sidebar panel** — a persistent, always-visible panel inside the
  OpenCode terminal UI showing every enabled provider's status at a glance.
- **CLI / slash commands** — `status-provider show` on the command line, or
  `/status-provider` and friends inside an OpenCode chat session, for an
  on-demand glance or full diagnostics.

Everything is computed **locally and deterministically** from data already
available to OpenCode (auth tokens, local CLI reports, or provider status
APIs) — no LLM call is ever used to compute status output, and status data
is never sent anywhere it doesn't already go.

## Installation

Pick whichever install path matches how you use OpenCode.

### npx (no install, always latest)

Use this if you just want to try it or run it occasionally without adding a
global dependency:

```bash
npx status-provider init
```

### `bun add -g` (global Bun install)

Use this if you already use Bun and want `status-provider` available as a
persistent global command:

```bash
bun add -g status-provider
status-provider init
```

### Local dev build (working on `status-provider` itself)

Use this if you're developing the plugin/CLI itself, or need an unreleased
change:

```bash
bun install
bun run build
```

### Inside the validation container (`plugin-status-provider`)

Use this when working from the pinned `plugin-status-provider` validation
sandbox (see [CONTRIBUTING.md](CONTRIBUTING.md) for how the sandbox is set
up) instead of your host OpenCode install:

```bash
bun /plugin/status-provider/dist/bin/status-provider.js config
```

## Quick start

```bash
status-provider init
status-provider show
status-provider config
```

Then, inside an OpenCode chat session:

- `/status-provider` — show status toast output in chat
- `/status-provider-toast` — force-show the actual popup toast right now
- `/status-provider-info` — diagnostics for toast + TUI + pricing + local storage

## Visual examples

### TUI sidebar panel — `default` text variant

![Sidebar default variant, classic layout](docs/images/sidebar-variant-a-classic.png)

*Classic sidebar layout: `textVariant: "default"`, `providerNameVariant: "full"`,
`percentVariant: "both"`. This is the only variant with a committed
screenshot right now — the other combinations below are described in text so
you know what to expect before you generate your own preview with
`status-provider config`.*

### Other sidebar visual variants

Every visual field below is defined in `StatusProviderConfig`
(`src/lib/types.ts`) and validated deterministically in
[`validation/qa-matrix.md`](validation/qa-matrix.md), which is the source of
truth for these values and defaults.

| Field | Values | Default | What changes |
|---|---|---|---|
| `formatStyle` | `singleWindow`, `allWindows` | `singleWindow` | `singleWindow` collapses each provider to one row; `allWindows` shows every quota window (e.g. 5-hour + weekly) per provider. |
| `percentDisplayMode` | `remaining`, `used` | `remaining` | Whether the percentage shown means "% left" or "% consumed". |
| `textVariant` | `default`, `minimal`, `box`, `emoji` | `default` | Row layout style — see mockups below. |
| `providerNameVariant` | `full`, `short`, `icon` | `full` | `full` prints the provider's display name (e.g. "Synthetic"); `short` prints an abbreviation (e.g. "Synth"); `icon` prefixes a symbol before the short name (e.g. "◇ Synth"). **Known quirk:** Anthropic's internal group name is `Claude` (not `Anthropic`), which isn't recognized by the name lookup — so this setting currently has no visible effect on the Anthropic row; it always renders as `[Claude]` regardless of variant (confirmed against real output). |
| `percentVariant` | `number`, `bar`, `both` | `both` | `number` shows just `72%`; `bar` shows just a progress bar; `both` shows bar + percentage. Note: in the sidebar, `bar` and `both` currently render identically. |
| `colorVariant` | `auto`, `none` | `none` | `auto` colors rows by remaining status. Has **no visible effect in the sidebar** (ANSI is stripped there) — it only changes toast and CLI output. |
| `alignmentVariant` | `left`, `right` | `left` | Row alignment. Only affects `minimal` text variant; other text variants ignore it. |

Illustrative mockups of `textVariant` (not real screenshots — generate your
own with the `status-provider config` live preview to see exact output):

```text
default   Copilot  [██████████    ]  72%
minimal   Copilot 72%
box       ┌ Copilot ────────── 72% ┐
emoji     🟢 Copilot  [██████████    ]  72%
```

`providerNameVariant` (shown on the grouped multi-window header used by
`formatStyle: allWindows`, e.g. for the Synthetic provider):

```text
full   [Synthetic]
short  [Synth]
icon   [◇ Synth]
```

Real captured output for Anthropic looks like this regardless of
`providerNameVariant` (the quirk noted in the table above):

```text
[Claude]
Session                        1h 8m
█████████████████████░░░░░  82% used
Weekly                      4d 6h 8m
███████████░░░░░░░░░░░░░░░  41% used
```

The most reliable way to see any specific combination rendered for real is
to run `status-provider config` — it shows a live boxed preview of your
exact settings before you save anything (see the wizard transcript below).

## Configuration

Primary config path:

```text
<config-root>/status-provider/config.json
```

`config-root` follows OpenCode config resolution. If `OPENCODE_CONFIG_DIR` is
set, that directory is used as the root.

There are two supported ways to change configuration: edit the JSON file
directly, or run the interactive wizard.

### Path A — Editing `config.json` directly

A full, realistic example (mixing several non-default choices so you can see
the shape of every top-level field):

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

> `percentDisplayMode` defaults to `"remaining"` (percent *left*). The
> `"used"` value above is just this example choosing to display percent
> *consumed* instead — it is not the built-in default.

You don't need to specify every field — `status-provider` merges your file
on top of `DEFAULT_CONFIG`, so a config file can be as small as a single
overridden field. Two focused examples:

Change only the row layout style:

```json
{
  "formatStyle": "allWindows"
}
```

Disable auto-detection and query only a specific, manually chosen set of
providers (order here does not control display order — use `providerOrder`
for that):

```json
{
  "enabledProviders": ["copilot", "openai", "anthropic"]
}
```

Key top-level fields (see `src/lib/types.ts` for the full, authoritative
list — this covers the fields most people touch):

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master on/off switch for the plugin. |
| `enableToast` | `boolean` | `true` | If `false`, never show popup toasts (commands/tools still work). |
| `formatStyle` | `"singleWindow" \| "allWindows"` | `"singleWindow"` | Shared row style for toasts and the TUI sidebar. Legacy aliases `"classic"` and `"grouped"` are still accepted. |
| `percentDisplayMode` | `"remaining" \| "used"` | `"remaining"` | Shared percent meaning for toasts and the sidebar. |
| `enabledProviders` | `string[] \| "auto"` | `"auto"` | Provider ids to query. `"auto"` enables every provider whose `isAvailable()` returns true at runtime. |
| `providerOrder` | `string[]` | `[]` | Explicit display order. Providers not listed are appended in default registry order; also implicitly disables providers omitted from the list when `enabledProviders` is `"auto"`. |
| `textVariant` / `toastTextVariant` | `"default" \| "minimal" \| "box" \| "emoji"` | `"default"` | Sidebar/CLI vs. toast row style, configured independently. |
| `providerNameVariant` / `toastProviderNameVariant` | `"full" \| "short" \| "icon"` | `"full"` | Provider name rendering. |
| `percentVariant` / `toastPercentVariant` | `"number" \| "bar" \| "both"` | `"both"` | Percent rendering. |
| `colorVariant` / `toastColorVariant` | `"auto" \| "none"` | `"none"` | Color by remaining status, or no color. |
| `alignmentVariant` / `toastAlignmentVariant` | `"left" \| "right"` | `"left"` | Row alignment (only visible with `minimal`). |
| `debug` | `boolean` | `false` | Appends a debug footer to the toast; shows a debug-only toast explaining why nothing rendered if applicable. |
| `minIntervalMs` | `number` | `300000` (5 min) | Minimum interval between toast pops. |
| `toastDurationMs` | `number` | `9000` | How long a toast stays visible. |
| `onlyCurrentModel` | `boolean` | `false` | If `true`, only show status for the current model. |
| `showSessionTokens` | `boolean` | `true` | Show the session input/output token section when data is available. |
| `tuiSidebarPanel.enabled` | `boolean` | `true` | Sidebar panel visibility when the TUI plugin is installed. |
| `tuiCompactStatus.enabled` | `boolean` | `false` | Opt-in compact status text for TUI prompt/home surfaces. |
| `anthropicBinaryPath` | `string` | `"claude"` | Path/command name for the local Claude CLI used by Anthropic probing. |
| `pricingSnapshot.source` | `"auto" \| "bundled" \| "runtime"` | `"auto"` | Where pricing data comes from. |
| `requestTimeoutMs` | `number` | `5000` | Timeout for remote provider API calls. |

Clean-start policy: `status-provider` does **not** migrate legacy config
automatically.

### Path B — Interactive wizard (`status-provider config`)

Running `status-provider config` walks you through every visual and
behavioral setting, then shows a live boxed preview of your exact choices
before writing anything to disk. `--dry-run` runs the whole wizard but never
saves. Below is a realistic transcript of a full walk-through:

```text
$ status-provider config

┌  Status Config
│
◆  How should providers be enabled?
│  ● Auto-detect      (enable providers that are available at runtime)
│  ○ Manual list       (choose exactly which providers to query)
└  Auto-detect

◆  Set provider display order?
│  ○ Default order     (use built-in order)
│  ● Custom order      (reorder providers; unlisted providers appended in default order)
└  Custom order

   Ordenar proveedores (space para seleccionar, ↑/↓ para mover, Enter para confirmar)
   > 1. Anthropic
     2. Copilot
     3. OpenAI
     4. Cursor
     ...
   Space: agarrar/soltar • ↑/↓: mover cursor • Enter: confirmar • Ctrl+C: cancelar
   (reordered: Copilot, OpenAI, Anthropic, ...)

◆  Format style for status rows?
│  ○ Single window     (collapse each provider to one row)
│  ● All windows       (show every status window)
└  All windows

◆  Percent display mode?
│  ● Remaining         (% left)
│  ○ Used              (% consumed)
└  Remaining

◆  Show popup toasts?
└  Yes

◆  Show session input/output tokens in displays?
└  Yes

◆  Only show status for the current model?
└  No

◆  Enable debug footer?
└  No

◆  Minimum interval between toasts (ms):
└  300000

◆  Toast duration (ms):
└  9000

Sidebar & CLI display
─────────────────────

◆  Text style for status rows (sidebar & CLI)?
│  ● Default   (name + bar + percent)
│  ○ Minimal   (single line per provider)
│  ○ Emoji     (status emoji prefix)
│  ○ Box       (box drawing framing)
└  Default

◆  Provider name style (sidebar & CLI)?
│  ● Full   (e.g. OpenAI)
│  ○ Short  (e.g. OpenAI)
│  ○ Icon   (symbol + short name)
└  Full

◆  Percent display style (sidebar & CLI)?
│  ○ Number  (percentage text only)
│  ○ Bar     (progress bar only)
│  ● Both    (bar + percentage)
└  Both

◆  Color mode (sidebar & CLI)?
│  ○ Auto  (color by remaining status)
│  ● None  (no colors)
└  None

◆  Row alignment (sidebar & CLI)?
│  ● Left
│  ○ Right
└  Left

┌────────────────────────────────────┐
│ Sidebar preview                     │
├────────────────────────────────────┤
│ Copilot  [██████████    ]  72%      │
│ OpenAI   [█████         ]  34%      │
└────────────────────────────────────┘

Toast popup display
───────────────────

◆  Copy sidebar settings as a starting point for the toast?
└  Yes

┌────────────────────────────────────┐
│ Toast preview                       │
├────────────────────────────────────┤
│ Copilot  [██████████    ]  72%      │
│ OpenAI   [█████         ]  34%      │
└────────────────────────────────────┘

Preview
───────
path: /home/you/.config/opencode/status-provider/config.json
dryRun: no

current:
  enabledProviders: auto
  providerOrder: (default)
  formatStyle: Single window
  ...

new:
  enabledProviders: auto
  providerOrder: copilot, openai, anthropic
  formatStyle: All windows
  ...

◆  Save these changes?
└  Yes

└  Saved.
```

Notes on the transcript above:

- The prompts, option labels, and hints shown are the real strings from
  `src/lib/cli-config.ts`; the `◆ / │ / ●` glyphs approximate the actual
  `@clack/prompts` rendering rather than reproducing it byte-for-byte.
- The provider-reorder step is a custom raw-keyboard prompt (arrow keys +
  space to grab/drop + Enter to confirm). Its title and footer hint are
  currently hard-coded in Spanish in this release ("Ordenar proveedores...",
  "Space: agarrar/soltar...") — everything else in the wizard is English.
- If you answer "No" to "Copy sidebar settings as a starting point for the
  toast?", the wizard repeats the same five style prompts (text/name/percent/
  color/alignment) again, labeled "(toast)" instead of "(sidebar & CLI)", so
  toast and sidebar can look completely different.
- Nothing is written to disk until you confirm "Save these changes?" — and
  with `status-provider config --dry-run`, that confirmation step is skipped
  entirely and no file is touched.

## CLI reference

```bash
status-provider --help
status-provider init
status-provider show [--provider <provider-id>]
status-provider config [--dry-run]
```

| Command | Flags | What it does |
|---|---|---|
| `init` | — | Runs the interactive `status-provider` installer. |
| `show` | `--provider <provider-id>` | Prints a quick status glance; optionally scoped to a single provider. |
| `config` | `--dry-run` (`-n`) | Interactive config editor for enabled providers, ordering, and display variants. `--dry-run` previews the wizard and its resulting diff without saving. |
| `--help` / `-h` / `help` | — | Prints CLI usage. |

## OpenCode slash commands

| Command | What it does |
|---|---|
| `/status-provider` | Show status toast output in chat. |
| `/status-provider-toast` | Force-show the actual popup toast right now (bypasses cache/interval). |
| `/status-provider-info` | Diagnostics for toast + TUI + pricing + local storage (includes an unknown-pricing report). |

The plugin also registers a few additional commands not covered above:
`/status_config` (same wizard as `status-provider config`, run from inside
OpenCode), `/pricing_refresh` (refresh the local pricing snapshot from
models.dev), and a set of `/tokens_*` session token report commands.

## Supported providers

18 providers are wired up today. "Auto-detected" providers need no manual
setup as long as the underlying OpenCode auth/companion-plugin credentials
already exist; "needs quick setup" providers require an extra step (see
`quickSetupAnchor` entries in `src/lib/provider-metadata.ts` for the
in-plugin pointer to that setup flow).

| Provider id | Display name | Auth type | Notes |
|---|---|---|---|
| `anthropic` | Anthropic | Local CLI auth | Reads status via the local Claude CLI (`anthropicBinaryPath`, default `claude`); needs quick setup. |
| `copilot` | Copilot | GitHub OAuth or PAT | OAuth for the personal flow; a fine-grained PAT is needed for org/enterprise billing reports. Usually auto-detected. |
| `openai` | OpenAI | OpenCode OAuth token | Auto-detected from OpenCode's ChatGPT/Codex OAuth session. |
| `cursor` | Cursor | OAuth via companion plugin | Needs a companion Cursor auth plugin plus local usage accounting; needs quick setup. |
| `qwen-code` | Qwen | OAuth via companion plugin | Needs a companion Qwen auth plugin; usage is locally estimated, not a remote quota API; needs quick setup. |
| `alibaba-coding-plan` | Alibaba Coding Plan | OpenCode-managed API key | Auto-detected from OpenCode auth, env var, or global config; usage is locally estimated. |
| `synthetic` | Synthetic | OpenCode-managed API key | Auto-detected from OpenCode auth, env var, or global config. |
| `chutes` | Chutes | OpenCode-managed API key | Usually auto-detected from OpenCode auth, env var, or global config. |
| `crof` | Crof | External API key | Requires `CROF_API_KEY` / `CROFAI_API_KEY` env var or trusted global config; not available through OpenCode `/connect`. |
| `google-antigravity` | Google | OAuth via companion plugin | Needs the Google Antigravity companion auth plugin; needs quick setup. |
| `google-gemini-cli` | Gemini CLI | OAuth via companion plugin | Needs a Gemini CLI companion auth plugin; needs quick setup. |
| `zai` | Z.ai | OpenCode-managed API key | Auto-detected from OpenCode auth, env var, or global config. |
| `zhipu` | Zhipu | OpenCode-managed API key | Auto-detected from OpenCode auth, env var, or global config. |
| `nanogpt` | NanoGPT | OpenCode-managed API key | Usually auto-detected from OpenCode auth, env var, or global config. |
| `minimax-coding-plan` | MiniMax Coding Plan | OpenCode-managed API key | Auto-detected from OpenCode auth, env var, or global config. |
| `minimax-china-coding-plan` | MiniMax Coding Plan (CN) | OpenCode-managed API key | China-region MiniMax plan; auto-detected the same way as `minimax-coding-plan`. |
| `kimi-for-coding` | Kimi Code | OpenCode-managed API key | Auto-detected from OpenCode auth, env var, or global config. |
| `opencode-go` | OpenCode Go | Session state only | Scrapes the OpenCode Go dashboard; requires `workspaceId` and `authCookie`; needs quick setup. |

## Development

```bash
bun run typecheck
bun run build
bun run test
```

Tests run through Vitest via `bun run test`; do not use Bun's built-in test
runner for this suite. Use `bun run test:watch` for local iteration, and
`bun run build:check` when you want the build plus a package dry-run check.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
full workflow, including the issue-first policy, local quality gates
(typecheck/test run as pre-commit hooks), CI checks, the provider-template
process for adding new providers, and the validation sandbox used for TUI
plugin-loading QA.

## Status & lineage

Initial independent release line: `0.1.x`.

`status-provider` is a clean-history successor derived from prior fork work,
but it is maintained as an independent project with its own package
identity, config path, commands, docs, and release policy. The previous fork
remains useful as historical reference; upstream changes may be reviewed
manually when useful, but they are not merged automatically. See
[LINEAGE.md](LINEAGE.md) for details.

## Publishing readiness

The package is prepared for npm/Bun publication as `status-provider`, with a
single binary named `status-provider`.

## License

MIT
