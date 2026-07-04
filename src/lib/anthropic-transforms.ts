/**
 * Anthropic request/response transforms for Claude Pro/Max OAuth.
 *
 * Ported from opencode-anthropic-login-via-cli (v1.6.1).
 * These transforms are required when using Claude with an OAuth token
 * (Claude Pro/Max subscription) instead of a standard API key:
 *
 * 1. Normalise the system prompt — inject Claude Code identity, remove
 *    OpenCode-specific identity paragraphs that would conflict.
 * 2. Inject a billing header (cc_version, cc_entrypoint, cch) so that
 *    Anthropic can attribute usage to the Pro/Max plan correctly.
 * 3. Prefix tool names with `mcp_` on outgoing requests and strip the
 *    prefix from streaming responses.
 */

import { createHash } from "crypto";
import { CLAUDE_CODE_ENTRYPOINT } from "./anthropic-introspection.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOOL_PREFIX = "mcp_";

const OPENCODE_IDENTITY_PREFIX = "You are OpenCode";
const CLAUDE_CODE_IDENTITY =
  "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const LEGACY_CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

const PARAGRAPH_REMOVAL_ANCHORS = ["github.com/anomalyco/opencode", "opencode.ai/docs"];

const TEXT_REPLACEMENTS: Array<{ match: string; replacement: string }> = [
  { match: "if OpenCode honestly", replacement: "if the assistant honestly" },
  {
    match: "Here is some useful information about the environment you are running in:",
    replacement: "Environment context you are running in:",
  },
];

// ---------------------------------------------------------------------------
// System prompt sanitization
// ---------------------------------------------------------------------------

const CCH_SALT = "59cf53e54c78";
const CCH_POSITIONS = [4, 7, 20];

function sanitizeSystemText(text: string): string {
  const paragraphs = text.split(/\n\n+/);
  const filtered = paragraphs.filter((paragraph) => {
    const trimmed = paragraph.trim();
    if (trimmed.startsWith(OPENCODE_IDENTITY_PREFIX)) return false;
    return !PARAGRAPH_REMOVAL_ANCHORS.some((anchor) => trimmed.includes(anchor));
  });
  let result = filtered.join("\n\n").replace(/\n{3,}/g, "\n\n");
  for (const rule of TEXT_REPLACEMENTS) {
    result = result.replace(rule.match, rule.replacement);
  }
  return result.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type SystemBlock = { type: "text"; text: string } & Record<string, unknown>;

function toTextSystemBlock(item: unknown): SystemBlock | null {
  if (typeof item === "string") {
    const sanitized = sanitizeSystemText(item);
    if (!sanitized) return null;
    return { type: "text", text: sanitized };
  }
  if (!isRecord(item)) return null;
  const hasSupportedType = item["type"] === "text" || item["type"] === undefined;
  if (!hasSupportedType || typeof item["text"] !== "string") return null;
  const sanitized = sanitizeSystemText(item["text"]);
  if (!sanitized) return null;
  return { ...item, type: "text", text: sanitized };
}

export function normalizeSystem(system: unknown): SystemBlock[] {
  const identityBlock: SystemBlock = { type: "text", text: CLAUDE_CODE_IDENTITY };

  if (system == null) return [identityBlock];

  const blocks: SystemBlock[] = Array.isArray(system)
    ? (system.map(toTextSystemBlock).filter((b): b is SystemBlock => b !== null))
    : ([toTextSystemBlock(system)].filter((b): b is SystemBlock => b !== null));

  if (blocks.length === 0) return [identityBlock];

  const firstText = blocks[0]!.text;
  if (firstText === CLAUDE_CODE_IDENTITY) return blocks;
  if (firstText === LEGACY_CLAUDE_CODE_IDENTITY) {
    blocks[0] = { ...blocks[0]!, type: "text", text: CLAUDE_CODE_IDENTITY };
    return blocks;
  }

  return [identityBlock, ...blocks];
}

// ---------------------------------------------------------------------------
// Billing header
// ---------------------------------------------------------------------------

function extractFirstUserMessageText(messages: unknown[]): string {
  const userMsg = messages.find(
    (m) => isRecord(m) && m["role"] === "user",
  ) as Record<string, unknown> | undefined;
  if (!userMsg) return "";
  const { content } = userMsg;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => isRecord(b) && b["type"] === "text") as
      | Record<string, unknown>
      | undefined;
    if (textBlock && typeof textBlock["text"] === "string") return textBlock["text"];
  }
  return "";
}

function computeCCH(messageText: string): string {
  return createHash("sha256").update(messageText).digest("hex").slice(0, 5);
}

function computeVersionSuffix(messageText: string, version: string): string {
  const chars = CCH_POSITIONS.map((index) => messageText[index] ?? "0").join("");
  return createHash("sha256")
    .update(`${CCH_SALT}${chars}${version}`)
    .digest("hex")
    .slice(0, 3);
}

export function buildBillingHeaderValue(messages: unknown[], version: string): string {
  const text = extractFirstUserMessageText(messages);
  const suffix = computeVersionSuffix(text, version);
  const cch = computeCCH(text);
  return (
    "x-anthropic-billing-header: " +
    `cc_version=${version}.${suffix}; ` +
    `cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; ` +
    `cch=${cch};`
  );
}

// ---------------------------------------------------------------------------
// Tool name prefix / unprefix
// ---------------------------------------------------------------------------

function prefixName(name: string): string {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

const PRESERVE_CASE_TOOL_NAMES = new Set(["StructuredOutput"]);

export function unprefixToolName(name: string): string {
  if (PRESERVE_CASE_TOOL_NAMES.has(name)) return name;
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

function prefixToolNamesInBody(parsed: Record<string, unknown>): void {
  if (Array.isArray(parsed["tools"])) {
    parsed["tools"] = parsed["tools"].map((tool: unknown) => {
      if (!isRecord(tool) || typeof tool["name"] !== "string") return tool;
      return { ...tool, name: prefixName(tool["name"]) };
    });
  }
  if (Array.isArray(parsed["messages"])) {
    parsed["messages"] = parsed["messages"].map((message: unknown) => {
      if (!isRecord(message) || !Array.isArray(message["content"])) return message;
      return {
        ...message,
        content: message["content"].map((block: unknown) => {
          if (isRecord(block) && block["type"] === "tool_use" && typeof block["name"] === "string") {
            return { ...block, name: prefixName(block["name"]) };
          }
          return block;
        }),
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Request body transform
// ---------------------------------------------------------------------------

export interface TransformResult {
  body: string;
  modelId: string | null;
}

export function transformRequestBody(rawBody: string, version: string): TransformResult {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const modelId = typeof parsed["model"] === "string" ? parsed["model"] : null;

    parsed["system"] = normalizeSystem(parsed["system"]);

    const hasUserMessage =
      Array.isArray(parsed["messages"]) &&
      (parsed["messages"] as unknown[]).some(
        (m) => isRecord(m) && m["role"] === "user",
      );

    if (hasUserMessage && Array.isArray(parsed["system"])) {
      const billingHeader = buildBillingHeaderValue(
        parsed["messages"] as unknown[],
        version,
      );
      (parsed["system"] as unknown[]).unshift({ type: "text", text: billingHeader });
    }

    prefixToolNamesInBody(parsed);

    return { body: JSON.stringify(parsed), modelId };
  } catch {
    return { body: rawBody, modelId: null };
  }
}

// ---------------------------------------------------------------------------
// Response streaming: unprefix tool names
// ---------------------------------------------------------------------------

const TOOL_NAME_RE = /"name"\s*:\s*"mcp_([^"]+)"/g;
const SSE_BOUNDARY = "\n\n";

/**
 * Drain `reader` into `buffer`, emitting each complete SSE event (delimited
 * by a trailing `\n\n`) as it becomes available. Bounded by `MAX_DRAIN_PASSES`
 * to avoid runaway awaits inside a single `pull()` invocation (which is what
 * caused the upstream Bun segfault: an unbounded `while (true)` awaiting
 * `reader.read()` from inside `pull()`).
 *
 * Returns `true` if the underlying reader is exhausted (`done`), `false`
 * otherwise.
 */
async function drainReader(params: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: InstanceType<typeof TextDecoder>;
  buffer: { value: string };
  emitEvent: (event: string) => void;
}): Promise<boolean> {
  const MAX_DRAIN_PASSES = 16;
  for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
    const { done, value } = await params.reader.read();
    if (done) {
      const remaining = params.decoder.decode();
      if (remaining) params.buffer.value += remaining;
      return true;
    }
    params.buffer.value += params.decoder.decode(value, { stream: true });

    while (true) {
      const boundary = params.buffer.value.indexOf(SSE_BOUNDARY);
      if (boundary === -1) break;
      const event = params.buffer.value.slice(0, boundary + SSE_BOUNDARY.length);
      params.buffer.value = params.buffer.value.slice(boundary + SSE_BOUNDARY.length);
      params.emitEvent(event);
    }
  }
  return false;
}

export function createToolNameUnprefixStream(reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const buffer = { value: "" };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const readerExhausted = await drainReader({
        reader,
        decoder,
        buffer,
        emitEvent: (event) => {
          const cleaned = event.replace(
            TOOL_NAME_RE,
            (_m, cap: string) => `"name": "${unprefixToolName(cap)}"`,
          );
          controller.enqueue(encoder.encode(cleaned));
        },
      });

      if (readerExhausted) {
        if (buffer.value) {
          const cleaned = buffer.value.replace(
            TOOL_NAME_RE,
            (_m, cap: string) => `"name": "${unprefixToolName(cap)}"`,
          );
          controller.enqueue(encoder.encode(cleaned));
          buffer.value = "";
        }
        controller.close();
      }
    },

    cancel(reason) {
      buffer.value = "";
      return reader.cancel(reason).catch(() => undefined);
    },
  });
}
