/**
 * Custom fetch interceptor for Anthropic OAuth (Claude Pro/Max).
 *
 * Ported from opencode-anthropic-login-via-cli (v1.6.1).
 *
 * Responsibilities:
 * 1. Proactively refresh the OAuth token before it expires.
 * 2. Inject required headers: Authorization, anthropic-beta, user-agent, x-app.
 * 3. Transform the request body (system prompt normalization, billing header, tool prefix).
 * 4. On 401/403 responses, find alternate credentials or force a CLI refresh and retry.
 * 5. On response, strip mcp_ prefix from tool names in the streaming body.
 * 6. Support ANTHROPIC_BASE_URL proxy override.
 */

import {
  isExpiringSoon,
  getCurrentRefreshToken,
  setCurrentRefreshToken,
  clearRefreshInFlight,
  resetRefreshState,
  refreshAnthropicAuth,
  findAlternateCredentials,
  refreshViaClaudeCli,
  type AnthropicAuthEntry,
  type OAuthTokens,
} from "./anthropic-credentials.js";

import {
  awaitIntro,
  getBetaFlags,
  getBetasForModel,
} from "./anthropic-introspection.js";

import {
  transformRequestBody,
  createToolNameUnprefixStream,
} from "./anthropic-transforms.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthState {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

export type GetAuthFn = () => Promise<AuthState>;

export type SetAuthFn = (tokens: OAuthTokens) => Promise<void>;

// ---------------------------------------------------------------------------
// Proxy helper
// ---------------------------------------------------------------------------

let _resolvedBaseUrl: URL | null | undefined = undefined;

function resolveBaseUrl(): URL | null {
  if (_resolvedBaseUrl !== undefined) return _resolvedBaseUrl;
  const raw = process.env["ANTHROPIC_BASE_URL"]?.trim();
  if (!raw) {
    _resolvedBaseUrl = null;
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      _resolvedBaseUrl = null;
      return null;
    }
    if (url.username || url.password) {
      _resolvedBaseUrl = null;
      return null;
    }
    _resolvedBaseUrl = url;
    return url;
  } catch {
    _resolvedBaseUrl = null;
    return null;
  }
}

function isInsecure(): boolean {
  if (!resolveBaseUrl()) return false;
  const raw = process.env["ANTHROPIC_INSECURE"]?.trim();
  return raw === "1" || raw === "true";
}

function rewriteOrigin(input: string | URL | Request): string | URL | Request {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return input;
  try {
    let reqUrl: URL;
    if (typeof input === "string") reqUrl = new URL(input);
    else if (input instanceof URL) reqUrl = new URL(input.toString());
    else if (input instanceof Request) reqUrl = new URL(input.url);
    else return input;

    const original = reqUrl.href;
    reqUrl.protocol = baseUrl.protocol;
    reqUrl.host = baseUrl.host;
    if (reqUrl.href === original) return input;
    return input instanceof Request ? new Request(reqUrl.toString(), input) : reqUrl;
  } catch {
    return input;
  }
}

function addBetaParam(input: string | URL | Request): string | URL | Request {
  try {
    let reqUrl: URL | null = null;
    if (typeof input === "string" || input instanceof URL) {
      reqUrl = new URL(input.toString());
    } else if (input instanceof Request) {
      reqUrl = new URL(input.url);
    }
    if (reqUrl?.pathname === "/v1/messages" && !reqUrl.searchParams.has("beta")) {
      reqUrl.searchParams.set("beta", "true");
      return input instanceof Request ? new Request(reqUrl.toString(), input) : reqUrl;
    }
  } catch {
    // ignore
  }
  return input;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function isLongContextError(body: string): boolean {
  return (
    body.includes("Extra usage is required for long context requests") ||
    body.includes("extra_usage") ||
    body.includes("usage_limit_exceeded")
  );
}

function isBillingError(body: string): boolean {
  return body.includes("billing_error");
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

function buildHeaders(input: string | URL | Request, init: RequestInit | undefined): Headers {
  const h = new Headers();
  if (input instanceof Request) {
    input.headers.forEach((v, k) => h.set(k, v));
  }
  if (init?.headers) {
    const ih = init.headers;
    if (ih instanceof Headers) {
      ih.forEach((v, k) => h.set(k, v));
    } else if (Array.isArray(ih)) {
      for (const [k, v] of ih as [string, string][]) {
        if (v !== undefined) h.set(k, String(v));
      }
    } else {
      for (const [k, v] of Object.entries(ih as Record<string, string>)) {
        if (v !== undefined) h.set(k, String(v));
      }
    }
  }
  return h;
}

// ---------------------------------------------------------------------------
// refreshAuth (mirrors opencode-anthropic-login-via-cli's refreshAuth)
// ---------------------------------------------------------------------------

async function refreshAuth(
  auth: AuthState,
  setAuth: SetAuthFn,
  binaryPath?: string,
): Promise<void> {
  const entry: AnthropicAuthEntry = {
    type: auth.type,
    access: auth.access,
    refresh: auth.refresh,
    expires: auth.expires,
  };

  const fresh = await refreshAnthropicAuth(entry, binaryPath);
  if (fresh) {
    await setAuth(fresh);
    auth.access = fresh.access;
    auth.refresh = fresh.refresh;
    auth.expires = fresh.expires;
    clearRefreshInFlight();
    setCurrentRefreshToken(fresh.refresh);
  }
}

// ---------------------------------------------------------------------------
// Retryable error handler (401, 403, 429, 529)
// ---------------------------------------------------------------------------

async function handleRetryableError(
  response: Response,
  auth: AuthState,
  setAuth: SetAuthFn,
  reqInput: string | URL | Request,
  reqInit: RequestInit,
  binaryPath?: string,
): Promise<Response> {
  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch {
    // ignore
  }

  // Non-retryable 429s (long context / billing)
  if (
    response.status === 429 &&
    (isLongContextError(responseBody) || isBillingError(responseBody))
  ) {
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // For 401/403 — try alternate credentials first, then CLI refresh
  let freshCreds: OAuthTokens | null = null;
  freshCreds = await findAlternateCredentials(getCurrentRefreshToken());
  if (!freshCreds && response.status === 401) {
    freshCreds = await refreshViaClaudeCli(binaryPath);
  }

  if (freshCreds && !isExpiringSoon(freshCreds.expires)) {
    clearRefreshInFlight();
    setCurrentRefreshToken(freshCreds.refresh);
    await setAuth(freshCreds);

    const headers = new Headers(reqInit.headers);
    headers.set("authorization", `Bearer ${freshCreds.access}`);
    return fetch(reqInput, { ...reqInit, headers });
  }

  // Return the original response body since we already consumed it
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// ---------------------------------------------------------------------------
// createCustomFetch — the main export
// ---------------------------------------------------------------------------

export function createCustomFetch(
  getAuth: GetAuthFn,
  setAuth: SetAuthFn,
  binaryPath?: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const intro = await awaitIntro();
    const { userAgent, betaHeaders, version } = intro;
    const auth = await getAuth();

    if (auth.type !== "oauth") return fetch(input, init);

    // Track refresh token rotation
    if (auth.refresh && auth.refresh !== getCurrentRefreshToken()) {
      clearRefreshInFlight();
      setCurrentRefreshToken(auth.refresh);
    }

    // Proactive token refresh
    if (!auth.access || !auth.expires || isExpiringSoon(auth.expires)) {
      await refreshAuth(auth, setAuth, binaryPath);
    }

    if (!auth.access) {
      return new Response(JSON.stringify({ error: "authentication_failed" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // Build request body with transforms
    const reqHeaders = buildHeaders(input, init);
    let body = init?.body;
    let modelId: string | null = null;

    if (body && typeof body === "string") {
      const transformed = transformRequestBody(body, version);
      body = transformed.body;
      modelId = transformed.modelId;
    } else if (
      body === undefined &&
      input instanceof Request &&
      reqHeaders.get("content-type")?.toLowerCase().includes("application/json")
    ) {
      try {
        const transformed = transformRequestBody(await input.clone().text(), version);
        body = transformed.body;
        modelId = transformed.modelId;
      } catch {
        // leave body as-is
      }
    }

    // Inject headers
    const baseBetas = getBetaFlags(betaHeaders);
    const modelBetas = modelId ? getBetasForModel(modelId, baseBetas) : baseBetas;
    const incoming = (reqHeaders.get("anthropic-beta") ?? "")
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    const merged = [...new Set([...modelBetas, ...incoming])].join(",");

    reqHeaders.set("authorization", `Bearer ${auth.access}`);
    reqHeaders.set("anthropic-beta", merged);
    reqHeaders.set("user-agent", userAgent);
    reqHeaders.set("x-app", "cli");
    reqHeaders.delete("x-api-key");

    const reqInput = rewriteOrigin(addBetaParam(input));
    const tlsOpts = isInsecure() ? { tls: { rejectUnauthorized: false } } : {};

    let response = await fetch(reqInput, { ...init, body, headers: reqHeaders, ...tlsOpts });

    // Retry on auth / overload errors
    if ([429, 529, 401, 403].includes(response.status)) {
      response = await handleRetryableError(
        response,
        auth,
        setAuth,
        reqInput,
        { ...init, body, headers: reqHeaders, ...tlsOpts },
        binaryPath,
      );
    }

    // Unprefix tool names in streaming response
    if (response.body) {
      const reader = response.body.getReader();
      const stream = createToolNameUnprefixStream(reader);
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  };
}

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export { resetRefreshState, setCurrentRefreshToken, getCurrentRefreshToken };
