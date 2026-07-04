import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("solid-js", () => ({
  createSignal: <T,>(value: T) => [() => value, vi.fn()],
  onCleanup: vi.fn(),
}));

vi.mock("react/jsx-runtime", () => ({
  Fragment: Symbol.for("Fragment"),
  jsx: vi.fn(),
  jsxs: vi.fn(),
}));

async function exists(url: URL): Promise<boolean> {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

describe("tui dist packaging", () => {
  it("ships compiled tui.js and removes the raw tsx and jsx artifacts", async () => {
    const distTuiJs = new URL("../dist/tui.js", import.meta.url);
    const distTuiTsx = new URL("../dist/tui.tsx", import.meta.url);
    const distJsx = new URL("../dist/tui.jsx", import.meta.url);
    const distJsxMap = new URL("../dist/tui.jsx.map", import.meta.url);

    expect(await exists(distTuiJs)).toBe(true);
    expect(await exists(distTuiTsx)).toBe(false);
    expect(await exists(distJsx)).toBe(false);
    expect(await exists(distJsxMap)).toBe(false);
  });

  it("can load the packaged TUI module", async () => {
    // TUI module uses @opentui/solid which requires node:ffi (Bun-only).
    // Skip when running under Node.js without FFI support.
    let mod: typeof import("../dist/tui.js");
    try {
      mod = await import("../dist/tui.js");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("node:ffi") || msg.includes("ERR_UNKNOWN_BUILTIN_MODULE")) {
        return;
      }
      throw error;
    }

    expect(mod.default).toMatchObject({
      id: "status-provider",
    });
    expect(typeof mod.default.tui).toBe("function");
  });
});
