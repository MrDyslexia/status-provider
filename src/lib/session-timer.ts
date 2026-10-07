/**
 * Session stopwatch helpers: pure formatting plus start-time resolution from
 * the TUI plugin API.
 */

type SessionTimerApi = {
  state?: {
    session?: {
      get?: (sessionID: string) => { time?: { created?: number } } | undefined;
      messages?: (sessionID: string) => ReadonlyArray<{ time?: { created?: number } }>;
    };
  };
};

/** Formats elapsed milliseconds as `HH:MM:SS` (hours unbounded beyond 2 digits). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolves the session start timestamp (epoch ms): `session.time.created`,
 * falling back to the earliest message `time.created`. Returns undefined when
 * the host has not hydrated session state yet.
 */
export function resolveSessionStartMs(api: SessionTimerApi, sessionID: string): number | undefined {
  const session = api.state?.session;

  try {
    const created = session?.get?.(sessionID)?.time?.created;
    if (isValidTimestamp(created)) return created;
  } catch {
    // fall through to messages
  }

  try {
    let earliest: number | undefined;
    for (const message of session?.messages?.(sessionID) ?? []) {
      const created = message?.time?.created;
      if (isValidTimestamp(created) && (earliest === undefined || created < earliest)) {
        earliest = created;
      }
    }
    return earliest;
  } catch {
    return undefined;
  }
}

/** Text shown in the UI, or "" when the start time is unknown. */
export function formatSessionTimerText(startMs: number | undefined, nowMs: number): string {
  if (startMs === undefined) return "";
  return formatElapsed(nowMs - startMs);
}
