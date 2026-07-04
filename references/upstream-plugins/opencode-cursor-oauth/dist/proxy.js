import { createHash } from "node:crypto";

function normalizeConversationMessages(messages) {
    return messages
        .filter((m) => m.role !== "tool")
        .map((m) => ({
        role: m.role,
        content: textContent(m.content),
    }))
        .filter((m) => m.content || m.role === "user" || m.role === "system");
}
/** Derive a key for active bridge lookup (tool-call continuations). Model-specific. */
function deriveBridgeKey(modelId, messages) {
    const normalizedMessages = normalizeConversationMessages(messages);
    return createHash("sha256")
        .update(JSON.stringify({
        modelId,
        messages: normalizedMessages,
    }))
        .digest("hex")
        .slice(0, 16);
}
/** Derive a key for conversation state. Model-independent so context survives model switches. */
function deriveConversationKey(messages) {
    const normalizedMessages = normalizeConversationMessages(messages);
    return createHash("sha256")
        .update(JSON.stringify({
        messages: normalizedMessages,
    }))
        .digest("hex")
        .slice(0, 16);
}
