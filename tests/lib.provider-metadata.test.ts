import { describe, expect, it } from "vitest";

import {
  STATUS_PROVIDER_ID_SYNONYMS,
  STATUS_PROVIDER_RUNTIME_IDS,
  STATUS_PROVIDER_SHAPES,
  getStatusProviderDisplayLabel,
  getStatusProviderRuntimeIds,
  getStatusProviderShape,
  normalizeStatusProviderId,
} from "../src/lib/provider-metadata.js";

describe("provider-metadata", () => {
  it("defines the canonical provider setup catalog", () => {
    expect(STATUS_PROVIDER_SHAPES).toEqual([
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
    ]);
  });

  it("keeps canonical provider setup ids unique", () => {
    const ids = STATUS_PROVIDER_SHAPES.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("normalizes provider synonyms to canonical ids", () => {
    expect(normalizeStatusProviderId("  openai  ")).toBe("openai");

    for (const [alias, canonicalId] of Object.entries(STATUS_PROVIDER_ID_SYNONYMS)) {
      expect(normalizeStatusProviderId(alias)).toBe(canonicalId);
    }
  });

  it("defines conservative runtime ids for provider matching", () => {
    expect(STATUS_PROVIDER_RUNTIME_IDS.copilot).toEqual([
      "copilot",
      "github-copilot",
      "copilot-chat",
      "github-copilot-chat",
    ]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.anthropic).toEqual(["anthropic"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.openai).toEqual(["openai", "chatgpt", "codex"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.cursor).toEqual(["cursor", "cursor-acp"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.synthetic).toEqual(["synthetic"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.chutes).toEqual(["chutes", "chutes-ai"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.crof).toEqual(["crof"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS["google-antigravity"]).toEqual([
      "google-antigravity",
      "google",
      "antigravity",
    ]);
    expect(STATUS_PROVIDER_RUNTIME_IDS["google-gemini-cli"]).toEqual([
      "google-gemini-cli",
      "gemini-cli",
      "gemini",
      "opencode-gemini-auth",
      "google",
    ]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.zai).toEqual(["zai", "glm", "zai-coding-plan"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.zhipu).toEqual([
      "zhipu",
      "glm-coding-plan",
      "zhipu-coding-plan",
    ]);
    expect(STATUS_PROVIDER_RUNTIME_IDS.nanogpt).toEqual(["nanogpt", "nano-gpt"]);
    expect(STATUS_PROVIDER_RUNTIME_IDS["minimax-coding-plan"]).toEqual([
      "minimax-coding-plan",
      "minimax",
    ]);
    expect(STATUS_PROVIDER_RUNTIME_IDS["minimax-china-coding-plan"]).toEqual([
      "minimax-china-coding-plan",
      "minimax-cn-coding-plan",
      "minimax-cn",
      "minimax-china",
    ]);
    expect(STATUS_PROVIDER_RUNTIME_IDS["kimi-for-coding"]).toEqual([
      "kimi-for-coding",
      "kimi",
      "kimi-code",
    ]);
  });

  it("keeps runtime ids distinct from broad normalization aliases", () => {
    expect(getStatusProviderRuntimeIds("github-copilot")).toEqual([
      "copilot",
      "github-copilot",
      "copilot-chat",
      "github-copilot-chat",
    ]);
    expect(getStatusProviderRuntimeIds("claude")).toEqual(["anthropic"]);
    expect(getStatusProviderRuntimeIds("openai")).toEqual(["openai", "chatgpt", "codex"]);
    expect(getStatusProviderRuntimeIds("open-cursor")).toEqual(["cursor", "cursor-acp"]);
    expect(getStatusProviderRuntimeIds("google-antigravity")).toEqual([
      "google-antigravity",
      "google",
      "antigravity",
    ]);
    expect(getStatusProviderRuntimeIds("gemini-cli")).toEqual([
      "google-gemini-cli",
      "gemini-cli",
      "gemini",
      "opencode-gemini-auth",
      "google",
    ]);
    expect(getStatusProviderRuntimeIds("zai")).toEqual(["zai", "glm", "zai-coding-plan"]);
    expect(getStatusProviderRuntimeIds("zhipu-coding-plan")).toEqual([
      "zhipu",
      "glm-coding-plan",
      "zhipu-coding-plan",
    ]);
    expect(getStatusProviderRuntimeIds("glm-coding-plan")).toEqual([
      "zhipu",
      "glm-coding-plan",
      "zhipu-coding-plan",
    ]);
    expect(getStatusProviderRuntimeIds("minimax")).toEqual([
      "minimax-coding-plan",
      "minimax",
    ]);
    expect(getStatusProviderRuntimeIds("minimax-cn")).toEqual([
      "minimax-china-coding-plan",
      "minimax-cn-coding-plan",
      "minimax-cn",
      "minimax-china",
    ]);
    expect(getStatusProviderRuntimeIds("kimi")).toEqual(["kimi-for-coding", "kimi", "kimi-code"]);
    expect(getStatusProviderRuntimeIds("not-a-provider")).toEqual([]);
  });

  it("returns provider setup metadata for canonical ids and aliases", () => {
    expect(getStatusProviderShape("openai")).toEqual({
      id: "openai",
      autoSetup: "yes",
      authentication: "opencode_auth_oauth_token",
      status: "remote_api",
    });
    expect(getStatusProviderShape("github-copilot")).toEqual({
      id: "copilot",
      autoSetup: "usually",
      authentication: "github_oauth_or_pat",
      status: "remote_api",
      notes: "OAuth for personal flow; PAT for managed billing",
    });
    expect(getStatusProviderShape("qwen")).toEqual({
      id: "qwen-code",
      autoSetup: "needs_quick_setup",
      authentication: "companion_auth_oauth_token",
      status: "local_estimation",
      quickSetupAnchor: "qwen-code-quick-setup",
    });
    expect(getStatusProviderShape("gemini-cli")).toEqual({
      id: "google-gemini-cli",
      autoSetup: "needs_quick_setup",
      authentication: "companion_auth_oauth_token",
      status: "remote_api",
      quickSetupAnchor: "google-gemini-cli-quick-setup",
    });
    expect(getStatusProviderShape("not-a-provider")).toBeUndefined();
  });

  it("returns display labels for known providers", () => {
    expect(getStatusProviderDisplayLabel("anthropic")).toBe("Anthropic");
    expect(getStatusProviderDisplayLabel("google-antigravity")).toBe("Google");
    expect(getStatusProviderDisplayLabel("gemini-cli")).toBe("Gemini CLI");
    expect(getStatusProviderDisplayLabel("cursor")).toBe("Cursor");
    expect(getStatusProviderDisplayLabel("alibaba-coding-plan")).toBe("Alibaba Coding Plan");
    expect(getStatusProviderDisplayLabel("synthetic")).toBe("Synthetic");
    expect(getStatusProviderDisplayLabel("zai")).toBe("Z.ai");
    expect(getStatusProviderDisplayLabel("zhipu")).toBe("Zhipu");
    expect(getStatusProviderDisplayLabel("zhipu-coding-plan")).toBe("Zhipu");
    expect(getStatusProviderDisplayLabel("nanogpt")).toBe("NanoGPT");
    expect(getStatusProviderDisplayLabel("nano-gpt")).toBe("NanoGPT");
    expect(getStatusProviderDisplayLabel("minimax")).toBe("MiniMax Coding Plan");
    expect(getStatusProviderDisplayLabel("minimax-cn-coding-plan")).toBe("MiniMax Coding Plan (CN)");
    expect(getStatusProviderDisplayLabel("kimi-code")).toBe("Kimi Code");
    expect(getStatusProviderDisplayLabel("kimi")).toBe("Kimi Code");
    expect(getStatusProviderDisplayLabel("something-else")).toBe("something-else");
  });
});
