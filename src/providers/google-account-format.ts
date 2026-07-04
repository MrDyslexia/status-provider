import type { StatusProviderError } from "../lib/entries.js";
import type { GoogleAccountError } from "../lib/types.js";

export type GoogleAccountLabelStyle = "fixedGmailHint" | "domainHint";

export function formatGoogleAccountLabel(
  email: string | undefined,
  style: GoogleAccountLabelStyle,
): string {
  if (!email) return "Unknown";

  if (style === "fixedGmailHint") {
    const prefix = email.slice(0, 3);
    return `${prefix}..gmail`;
  }

  const [local = email] = email.split("@");
  const prefix = local.slice(0, 3) || email.slice(0, 3);
  const domainHint = email.includes("@") ? email.split("@")[1]?.split(".")[0] : undefined;
  return domainHint ? `${prefix}..${domainHint}` : `${prefix}..`;
}

export function formatGoogleAccountErrors(
  errors: readonly GoogleAccountError[] | undefined,
  style: GoogleAccountLabelStyle,
): StatusProviderError[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((error) => ({
    label: formatGoogleAccountLabel(error.email, style),
    message: error.error,
  }));
}
