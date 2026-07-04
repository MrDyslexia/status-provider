/**
 * Tests for `createToolNameUnprefixStream`.
 *
 * The stream transform replaces `mcp_<Name>` with `<name>` in JSON payloads
 * streamed from the Anthropic OAuth endpoint. These tests guard against the
 * regression that caused Bun segfaults when an async `while (true)` loop
 * inside `pull()` got into runaway `await reader.read()` recursion.
 */

import { describe, expect, it } from "vitest";
import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";

import { createToolNameUnprefixStream } from "../src/lib/anthropic-transforms.js";

function makeReaderFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return source.getReader();
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("createToolNameUnprefixStream", () => {
  it("unprefixes mcp_ tool names inside a single SSE chunk", async () => {
    const reader = makeReaderFromChunks([
      'event: content_block_start\ndata: {"type":"tool_use","name":"mcp_Bash","input":{}}\n\n',
    ]);
    const stream = createToolNameUnprefixStream(reader);
    const out = await collect(stream);
    expect(out).toContain('"name": "bash"');
    expect(out).not.toContain("mcp_Bash");
  });

  it("emits data even when the SSE stream ends without a trailing \\n\\n", async () => {
    // Regression: the previous implementation waited for "\n\n" before emitting
    // anything, so a stream that closed after a partial chunk left buffered
    // data behind. The unprefixer must still emit the trailing partial chunk.
    const reader = makeReaderFromChunks([
      'event: content_block_start\ndata: {"name":"mcp_Read"}\n', // no closing \n\n
    ]);
    const stream = createToolNameUnprefixStream(reader);
    const out = await collect(stream);
    expect(out).toContain('"name": "read"');
  });

  it("handles multi-chunk streams where boundaries fall mid-event", async () => {
    const reader = makeReaderFromChunks([
      'event: content_block_start\ndata: {"name":"mcp_Bash"}\n\nevent: ping\n',
    ]);
    const stream = createToolNameUnprefixStream(reader);
    const out = await collect(stream);
    expect(out).toContain('"name": "bash"');
    expect(out).toContain("event: ping");
  });

  it("forwards non-prefixed names untouched", async () => {
    const reader = makeReaderFromChunks([
      'data: {"name":"StructuredOutput"}\n\n',
    ]);
    const stream = createToolNameUnprefixStream(reader);
    const out = await collect(stream);
    expect(out).toContain('"name":"StructuredOutput"');
  });
});