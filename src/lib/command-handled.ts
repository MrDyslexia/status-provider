/**
 * Command-handled sentinel.
 *
 * Thrown by slash-command handlers to signal that the command output
 * has already been injected and no further processing is needed.
 */

export const COMMAND_HANDLED_SENTINEL = "Aborted" as const;

/**
 * Throw the command-handled sentinel.
 * Use this instead of `throw new Error("Aborted")`.
 */
export function handled(): never {
  throw new DOMException(COMMAND_HANDLED_SENTINEL, "AbortError");
}

/**
 * Returns true when an error is the command-handled sentinel.
 */
export function isCommandHandledError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError" && err.message === COMMAND_HANDLED_SENTINEL;
}
