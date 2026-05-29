import type { ConversationMessage } from "./schemas/tenancy.js";

export type { ConversationMessage } from "./schemas/tenancy.js";
export { ConversationMessageSchema } from "./schemas/tenancy.js";

const MAX_CONTEXT_MESSAGES = 40;
const MAX_CONTEXT_CHARS = 24_000;

/**
 * Builds short-term context from full OpenAI-style message history.
 */
export function buildConversationContext(messages: ConversationMessage[]): string[] {
  const trimmed = messages.slice(-MAX_CONTEXT_MESSAGES);
  const lines: string[] = [];
  let chars = 0;

  for (const msg of trimmed) {
    const line = `[${msg.role}] ${msg.content}`;
    if (chars + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    chars += line.length;
  }

  return lines;
}

export function lastUserMessage(messages: ConversationMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last?.content ?? "";
}
