import { describe, expect, it } from "vitest";

import {
  formatElapsed,
  formatSessionTimerText,
  resolveSessionStartMs,
} from "../src/lib/session-timer.js";

describe("formatElapsed", () => {
  it("formats under an hour as 00:MM:SS", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(5_999)).toBe("00:00:05");
    expect(formatElapsed(65_000)).toBe("00:01:05");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("00:59:59");
  });

  it("formats an hour or more as HH:MM:SS", () => {
    expect(formatElapsed(3_600_000)).toBe("01:00:00");
    expect(formatElapsed(3_600_000 * 26 + 61_000)).toBe("26:01:01");
  });

  it("clamps negative and invalid values to zero", () => {
    expect(formatElapsed(-5_000)).toBe("00:00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00:00");
  });
});

describe("resolveSessionStartMs", () => {
  it("prefers session.time.created", () => {
    const api = {
      state: {
        session: {
          get: () => ({ time: { created: 1_000 } }),
          messages: () => [{ time: { created: 5_000 } }],
        },
      },
    };
    expect(resolveSessionStartMs(api, "s")).toBe(1_000);
  });

  it("falls back to the earliest message timestamp", () => {
    const api = {
      state: {
        session: {
          get: () => undefined,
          messages: () => [{ time: { created: 9_000 } }, { time: { created: 4_000 } }, {}],
        },
      },
    };
    expect(resolveSessionStartMs(api, "s")).toBe(4_000);
  });

  it("returns undefined when nothing is hydrated or accessors throw", () => {
    expect(resolveSessionStartMs({}, "s")).toBeUndefined();
    expect(
      resolveSessionStartMs(
        {
          state: {
            session: {
              get: () => {
                throw new Error("boom");
              },
              messages: () => {
                throw new Error("boom");
              },
            },
          },
        },
        "s",
      ),
    ).toBeUndefined();
  });
});

describe("formatSessionTimerText", () => {
  it("renders with a stopwatch prefix, or empty when start unknown", () => {
    expect(formatSessionTimerText(1_000, 66_000)).toBe("00:01:05");
    expect(formatSessionTimerText(undefined, 66_000)).toBe("");
  });
});
