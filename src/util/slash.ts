import type { CommandInfo } from "../api/types";

export interface SlashContext {
  start: number;
  end: number;
  query: string;
}

export interface SlashInvocation {
  name: string;
  args: string;
}

/**
 * Returns the slash token under the cursor. Commands are only offered at the very
 * start of a message: "/rev" opens the palette, while "/review please" does not.
 */
export function slashContext(text: string, cursor: number): SlashContext | undefined {
  const before = text.slice(0, cursor);
  if (!before.startsWith("/")) return undefined;
  if (/\s/.test(before)) return undefined;
  const rest = text.slice(cursor).match(/^\S*/)?.[0] ?? "";
  return { start: 0, end: cursor + rest.length, query: before.slice(1) };
}

export function parseInvocation(text: string): SlashInvocation | undefined {
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;
  return {
    name: match[1] ?? "",
    args: match[2] ?? "",
  };
}

export function commandInsertion(name: string): string {
  return `/${name} `;
}

export function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  const needle = query.trim().toLowerCase();
  return commands
    .map((command) => {
      const name = command.name.toLowerCase();
      const description = (command.description ?? "").toLowerCase();
      let score = 3;
      if (!needle) score = 1;
      else if (name === needle) score = 0;
      else if (name.startsWith(needle)) score = 1;
      else if (name.includes(needle)) score = 2;
      else if (description.includes(needle)) score = 3;
      else score = 4;
      return { command, score };
    })
    .filter((entry) => entry.score < 4)
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name))
    .map((entry) => entry.command);
}
