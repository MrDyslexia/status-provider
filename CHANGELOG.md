# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Initial release

### Added
- OpenCode plugin and CLI (`status-provider`) for provider usage status, quota windows, and runtime diagnostics.
- Sidebar and TUI panels with configurable display previews across AI providers.
- Interactive config wizard (`status-provider config`) for enabling/ordering providers, format style, percent mode, toast settings, and color/alignment variants.
- `/status-provider`, `/status-provider-info`, and `/status-provider-toast` commands.
- Provider status resolution for Anthropic, GitHub Copilot, Google, OpenAI, MiniMax, Kimi, and Ollama Cloud.

### Fixed
- Prioritize OpenCode `auth.json` over Claude CLI status for the Anthropic provider.
- Stabilized OpenCode validation and sidebar status layout.
- Cleaned up status-provider identity and plugin command registration.

[0.1.0]: https://github.com/MrDyslexia/status-provider/releases/tag/v0.1.0
