import { describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_OAUTH_CLIENT_ID,
  buildAnthropicAuthorizeUrl,
  exchangeAnthropicAuthorizationCode,
} from "../src/lib/anthropic-credentials.js";

describe("buildAnthropicAuthorizeUrl", () => {
  it("matches the parameters Claude Code sends for a claude.ai login", () => {
    const url = new URL(buildAnthropicAuthorizeUrl({ challenge: "chal", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://claude.com/cai/oauth/authorize");
    expect(url.searchParams.get("code")).toBe("true");
    expect(url.searchParams.get("client_id")).toBe(ANTHROPIC_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://platform.claude.com/oauth/code/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload user:plugins",
    );
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("exchangeAnthropicAuthorizationCode", () => {
  it("posts JSON with the bare code and returns tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
        { status: 200 },
      ),
    );
    const tokens = await exchangeAnthropicAuthorizationCode({
      rawCode: " abc#state ",
      verifier: "ver",
      state: "ver",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(tokens.access).toBe("a");
    expect(tokens.refresh).toBe("r");
    expect(tokens.expires).toBeGreaterThan(Date.now());

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://platform.claude.com/v1/oauth/token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("status-provider");
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: "https://platform.claude.com/oauth/code/callback",
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      code_verifier: "ver",
      state: "ver",
    });
  });

  it("throws with status and body when the exchange fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":"rate_limit_error"}', { status: 429, statusText: "Too Many" }),
    );
    await expect(
      exchangeAnthropicAuthorizationCode({
        rawCode: "x",
        verifier: "v",
        state: "v",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/429.*rate_limit_error/);
  });
});
