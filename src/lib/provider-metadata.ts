export type CanonicalStatusProviderId =
  | "anthropic"
  | "copilot"
  | "openai"
  | "cursor"
  | "qwen-code"
  | "alibaba-coding-plan"
  | "synthetic"
  | "chutes"
  | "crof"
  | "google-antigravity"
  | "google-gemini-cli"
  | "zai"
  | "zhipu"
  | "nanogpt"
  | "minimax-coding-plan"
  | "minimax-china-coding-plan"
  | "kimi-for-coding"
  | "opencode-go";

export type StatusProviderAutoSetup = "yes" | "usually" | "manual_env_config" | "needs_quick_setup";

export type StatusProviderAuthentication =
  | "opencode_auth_oauth_token"
  | "opencode_auth_api_key"
  | "companion_auth_oauth_token"
  | "local_cli_auth"
  | "github_oauth_or_pat"
  | "external_api_key"
  | "state_only";

export type StatusProviderAuthFallback = "env_api_key" | "global_opencode_config";

export type StatusProviderStatusSource =
  | "remote_api"
  | "local_estimation"
  | "local_runtime_accounting"
  | "local_cli_report";

export interface StatusProviderShape {
  id: CanonicalStatusProviderId;
  autoSetup: StatusProviderAutoSetup;
  authentication: StatusProviderAuthentication;
  authFallbacks?: StatusProviderAuthFallback[];
  status: StatusProviderStatusSource;
  quickSetupAnchor?: string;
  notes?: string;
}

export type StatusProviderRuntimeIds = Readonly<Record<CanonicalStatusProviderId, readonly string[]>>;

export const STATUS_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  copilot: "Copilot",
  "google-antigravity": "Google",
  "google-gemini-cli": "Gemini CLI",
  synthetic: "Synthetic",
  chutes: "Chutes",
  crof: "Crof",
  cursor: "Cursor",
  "qwen-code": "Qwen",
  "alibaba-coding-plan": "Alibaba Coding Plan",
  zai: "Z.ai",
  zhipu: "Zhipu",
  nanogpt: "NanoGPT",
  "minimax-coding-plan": "MiniMax Coding Plan",
  "minimax-china-coding-plan": "MiniMax Coding Plan (CN)",
  "minimax-cn-coding-plan": "MiniMax Coding Plan (CN)",
  "kimi-for-coding": "Kimi Code",
  "kimi-code": "Kimi Code",
  "opencode-go": "OpenCode Go",
};

export const STATUS_PROVIDER_ID_SYNONYMS: Readonly<Record<string, string>> = {
  "github-copilot": "copilot",
  "copilot-chat": "copilot",
  "github-copilot-chat": "copilot",
  "cursor-acp": "cursor",
  "open-cursor": "cursor",
  "@rama_nigg/open-cursor": "cursor",
  claude: "anthropic",
  "claude-code": "anthropic",
  qwen: "qwen-code",
  alibaba: "alibaba-coding-plan",
  "nano-gpt": "nanogpt",
  minimax: "minimax-coding-plan",
  "minimax-cn": "minimax-china-coding-plan",
  "minimax-china": "minimax-china-coding-plan",
  "minimax-cn-coding-plan": "minimax-china-coding-plan",
  kimi: "kimi-for-coding",
  "kimi-for-code": "kimi-for-coding",
  "kimi-code": "kimi-for-coding",
  "opencode-go-subscription": "opencode-go",
  "gemini-cli": "google-gemini-cli",
  "google-gemini": "google-gemini-cli",
  "opencode-gemini-auth": "google-gemini-cli",
  gemini: "google-gemini-cli",
  "glm-coding-plan": "zhipu",
  "zhipu-coding-plan": "zhipu",
};

export const STATUS_PROVIDER_RUNTIME_IDS: StatusProviderRuntimeIds = {
  anthropic: ["anthropic"],
  copilot: ["copilot", "github-copilot", "copilot-chat", "github-copilot-chat"],
  openai: ["openai", "chatgpt", "codex"],
  cursor: ["cursor", "cursor-acp"],
  "qwen-code": ["qwen-code"],
  "alibaba-coding-plan": ["alibaba-coding-plan"],
  synthetic: ["synthetic"],
  chutes: ["chutes", "chutes-ai"],
  crof: ["crof"],
  "google-antigravity": ["google-antigravity", "google", "antigravity"],
  "google-gemini-cli": [
    "google-gemini-cli",
    "gemini-cli",
    "gemini",
    "opencode-gemini-auth",
    "google",
  ],
  zai: ["zai", "glm", "zai-coding-plan"],
  zhipu: ["zhipu", "glm-coding-plan", "zhipu-coding-plan"],
  nanogpt: ["nanogpt", "nano-gpt"],
  "minimax-coding-plan": ["minimax-coding-plan", "minimax"],
  "minimax-china-coding-plan": [
    "minimax-china-coding-plan",
    "minimax-cn-coding-plan",
    "minimax-cn",
    "minimax-china",
  ],
  "kimi-for-coding": ["kimi-for-coding", "kimi", "kimi-code"],
  "opencode-go": ["opencode-go"],
};

const LIVE_LOCAL_USAGE_PROVIDER_ID_SET = new Set<string>([
  "qwen-code",
  "alibaba-coding-plan",
  "cursor",
]);

export const STATUS_PROVIDER_SHAPES: readonly StatusProviderShape[] = [
  {
    id: "anthropic",
    autoSetup: "needs_quick_setup",
    authentication: "local_cli_auth",
    status: "local_cli_report",
    quickSetupAnchor: "anthropic-quick-setup",
  },
  {
    id: "copilot",
    autoSetup: "usually",
    authentication: "github_oauth_or_pat",
    status: "remote_api",
    notes: "OAuth for personal flow; PAT for managed billing",
  },
  {
    id: "openai",
    autoSetup: "yes",
    authentication: "opencode_auth_oauth_token",
    status: "remote_api",
  },
  {
    id: "cursor",
    autoSetup: "needs_quick_setup",
    authentication: "companion_auth_oauth_token",
    status: "local_runtime_accounting",
    quickSetupAnchor: "cursor-quick-setup",
    notes: "companion runtime/plugin integration plus local usage accounting",
  },
  {
    id: "qwen-code",
    autoSetup: "needs_quick_setup",
    authentication: "companion_auth_oauth_token",
    status: "local_estimation",
    quickSetupAnchor: "qwen-code-quick-setup",
  },
  {
    id: "alibaba-coding-plan",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "local_estimation",
  },
  {
    id: "synthetic",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "chutes",
    autoSetup: "usually",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "crof",
    autoSetup: "manual_env_config",
    authentication: "external_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
    notes: "Requires CROF_API_KEY, CROFAI_API_KEY, or trusted user/global config; not available through OpenCode /connect",
  },
  {
    id: "google-antigravity",
    autoSetup: "needs_quick_setup",
    authentication: "companion_auth_oauth_token",
    status: "remote_api",
    quickSetupAnchor: "google-antigravity-quick-setup",
  },
  {
    id: "google-gemini-cli",
    autoSetup: "needs_quick_setup",
    authentication: "companion_auth_oauth_token",
    status: "remote_api",
    quickSetupAnchor: "google-gemini-cli-quick-setup",
  },
  {
    id: "zai",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "zhipu",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "nanogpt",
    autoSetup: "usually",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "minimax-coding-plan",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "minimax-china-coding-plan",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "kimi-for-coding",
    autoSetup: "yes",
    authentication: "opencode_auth_api_key",
    authFallbacks: ["env_api_key", "global_opencode_config"],
    status: "remote_api",
  },
  {
    id: "opencode-go",
    autoSetup: "needs_quick_setup",
    authentication: "state_only",
    status: "remote_api",
    quickSetupAnchor: "opencode-go-quick-setup",
    notes: "Scrapes the OpenCode Go dashboard; requires workspaceId and authCookie",
  },
];

const STATUS_PROVIDER_SHAPES_BY_ID: Readonly<
  Partial<Record<CanonicalStatusProviderId, StatusProviderShape>>
> = Object.fromEntries(STATUS_PROVIDER_SHAPES.map((shape) => [shape.id, shape]));

export function normalizeStatusProviderId(id: string): string {
  const normalized = id.trim().toLowerCase();
  return STATUS_PROVIDER_ID_SYNONYMS[normalized] ?? normalized;
}

export function getStatusProviderShape(id: string): StatusProviderShape | undefined {
  const normalized = normalizeStatusProviderId(id) as CanonicalStatusProviderId;
  return STATUS_PROVIDER_SHAPES_BY_ID[normalized];
}

export const STATUS_PROVIDER_SHORT_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anth",
  openai: "OpenAI",
  copilot: "Copilot",
  "google-antigravity": "Google",
  "google-gemini-cli": "Gemini",
  synthetic: "Synth",
  chutes: "Chutes",
  crof: "Crof",
  cursor: "Cursor",
  "qwen-code": "Qwen",
  "alibaba-coding-plan": "Alibaba",
  zai: "Z.ai",
  zhipu: "Zhipu",
  nanogpt: "Nano",
  "minimax-coding-plan": "MiniMax",
  "minimax-china-coding-plan": "MiniMax CN",
  "minimax-cn-coding-plan": "MiniMax CN",
  "kimi-for-coding": "Kimi",
  "kimi-code": "Kimi",
  "opencode-go": "OC Go",
};

export const STATUS_PROVIDER_ICONS: Readonly<Record<string, string>> = {
  anthropic: "◆",
  openai: "◎",
  copilot: "⌘",
  "google-antigravity": "▲",
  "google-gemini-cli": "▲",
  synthetic: "◇",
  chutes: "⚡",
  crof: "◉",
  cursor: "▣",
  "qwen-code": "✦",
  "alibaba-coding-plan": "✶",
  zai: "⬡",
  zhipu: "⬢",
  nanogpt: "◈",
  "minimax-coding-plan": "◆",
  "minimax-china-coding-plan": "◆",
  "minimax-cn-coding-plan": "◆",
  "kimi-for-coding": "◐",
  "kimi-code": "◐",
  "opencode-go": "◯",
};

export function getStatusProviderDisplayLabel(id: string): string {
  const normalized = normalizeStatusProviderId(id);
  return STATUS_PROVIDER_LABELS[normalized] ?? id;
}

export function getStatusProviderShortLabel(id: string): string {
  const normalized = normalizeStatusProviderId(id);
  return STATUS_PROVIDER_SHORT_LABELS[normalized] ?? STATUS_PROVIDER_LABELS[normalized] ?? id;
}

export function getStatusProviderIcon(id: string): string {
  const normalized = normalizeStatusProviderId(id);
  return STATUS_PROVIDER_ICONS[normalized] ?? "●";
}

export function findStatusProviderIdByDisplayLabel(label: string): string | undefined {
  const normalized = label.trim().toLowerCase();
  for (const [id, display] of Object.entries(STATUS_PROVIDER_LABELS)) {
    if (display.toLowerCase() === normalized) {
      return id;
    }
  }
  return undefined;
}

export function getStatusProviderRuntimeIds(id: string): readonly string[] {
  const shape = getStatusProviderShape(id);
  if (!shape) {
    return [];
  }

  return [...new Set(STATUS_PROVIDER_RUNTIME_IDS[shape.id])];
}

export function isLiveLocalUsageProviderId(id: string): boolean {
  return LIVE_LOCAL_USAGE_PROVIDER_ID_SET.has(normalizeStatusProviderId(id));
}
