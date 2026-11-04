import type { PromptMention } from "../api/types";
import { baseName } from "./path";

export interface MentionContext {
  start: number;
  end: number;
  query: string;
}

const MENTION_PREFIX = new Set([" ", "\t", "\n", "(", "[", "{", '"', "'"]);

/**
 * Finds an active `@` mention under the cursor. The `@` must start a token, so
 * email addresses and `foo@bar` do not open the file picker.
 */
export function mentionContext(text: string, cursor: number): MentionContext | undefined {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at === -1) return undefined;
  if (at > 0 && !MENTION_PREFIX.has(before[at - 1] ?? "")) return undefined;

  const query = before.slice(at + 1);
  if (/\s/.test(query)) return undefined;

  const rest = text.slice(cursor).match(/^\S*/)?.[0] ?? "";
  return { start: at, end: cursor + rest.length, query };
}

export function insertMention(
  text: string,
  context: MentionContext,
  path: string,
): { text: string; cursor: number } {
  const replacement = `@${path} `;
  const after = text.slice(context.end);
  // The replacement already ends with a space, so swallow one trailing space
  // from the original text to avoid doubling it.
  const rest = /^\s/.test(after) ? after.slice(1) : after;
  const next = text.slice(0, context.start) + replacement + rest;
  return { text: next, cursor: context.start + replacement.length };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locates the mention text for an attachment in the final prompt. Mention offsets
 * are presentation metadata; when the user has removed the mention we simply omit it.
 */
export function mentionForText(text: string, path: string): PromptMention | undefined {
  const candidates = [`@${path}`, `@${baseName(path)}`];
  for (const candidate of candidates) {
    const pattern = new RegExp(`${escapeRegExp(candidate)}(?=$|[\\s.,;:!?)\\]}"'])`, "u");
    const match = pattern.exec(text);
    if (match) return { start: match.index, end: match.index + candidate.length, text: candidate };
  }
  return undefined;
}
