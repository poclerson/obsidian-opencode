import { describe, expect, test } from "vitest";
import { commandInsertion, filterCommands, parseInvocation, slashContext } from "../src/util/slash";

const commands = [
  { name: "review", description: "review changes" },
  { name: "init", description: "guided AGENTS.md setup" },
  { name: "help", description: "show help" },
  { name: "deep-review", description: "long review" },
];

describe("slashContext", () => {
  test("matches a command token at the start", () => {
    expect(slashContext("/rev", 4)).toEqual({ start: 0, end: 4, query: "rev" });
    expect(slashContext("/rev more", 4)).toEqual({ start: 0, end: 4, query: "rev" });
  });

  test("does not match after arguments begin", () => {
    expect(slashContext("/review please", 9)).toBeUndefined();
    expect(slashContext("hello /rev", 9)).toBeUndefined();
  });

  test("replaces the whole token when the cursor is in the middle", () => {
    expect(slashContext("/review", 4)).toEqual({ start: 0, end: 7, query: "rev" });
  });
});

describe("parseInvocation", () => {
  test("splits the command name from its arguments", () => {
    expect(parseInvocation("/review")).toEqual({ name: "review", args: "" });
    expect(parseInvocation("/review commit please")).toEqual({ name: "review", args: "commit please" });
  });

  test("ignores normal prompts", () => {
    expect(parseInvocation("review this")).toBeUndefined();
    expect(parseInvocation("/")).toBeUndefined();
  });
});

describe("filterCommands", () => {
  test("prefers prefix matches", () => {
    expect(filterCommands(commands, "re").map((command) => command.name)).toEqual([
      "review",
      "deep-review",
    ]);
  });

  test("matches descriptions", () => {
    expect(filterCommands(commands, "agents").map((command) => command.name)).toEqual(["init"]);
  });

  test("returns everything for an empty query", () => {
    expect(filterCommands(commands, "")).toHaveLength(4);
  });
});

test("commandInsertion adds a trailing space", () => {
  expect(commandInsertion("review")).toBe("/review ");
});
