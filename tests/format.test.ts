import { describe, expect, test } from "vitest";
import {
  attachmentUri,
  formatCost,
  formatTokens,
  hashString,
  messageSignature,
  truncate,
} from "../src/util/format";
import type { AssistantMessage, UserMessage } from "../src/api/types";

describe("formatting", () => {
  test("formats tokens", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5m");
  });

  test("formats costs", () => {
    expect(formatCost(0)).toBe("");
    expect(formatCost(0.00001)).toBe("<$0.0001");
    expect(formatCost(0.0123)).toBe("$0.012");
  });

  test("truncates long text", () => {
    expect(truncate("abcdef", 3)).toContain("abc");
    expect(truncate("abcdef", 3)).toContain("3 more characters");
  });
});

describe("messageSignature", () => {
  test("changes when streamed text changes", () => {
    const base: AssistantMessage = {
      id: "msg_1",
      type: "assistant",
      time: { created: 1 },
      content: [{ type: "text", text: "hello" }],
    };
    const next: AssistantMessage = {
      ...base,
      content: [{ type: "text", text: "hello world" }],
    };
    expect(messageSignature(base)).not.toBe(messageSignature(next));
  });

  test("ignores attachment bytes but notices the file name", () => {
    const one: UserMessage = {
      id: "msg_1",
      type: "user",
      time: { created: 1 },
      text: "hi",
      files: [{ uri: "file:///a.md", name: "a.md", data: "AAAA" }],
    };
    const two: UserMessage = { ...one, files: [{ ...one.files![0]!, data: "BBBB" }] };
    const three: UserMessage = { ...one, files: [{ ...one.files![0]!, name: "b.md" }] };
    expect(messageSignature(one)).toBe(messageSignature(two));
    expect(messageSignature(one)).not.toBe(messageSignature(three));
  });

  test("is stable for equal objects", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
  });
});

describe("attachmentUri", () => {
  test("reads both top-level and sourced attachment URIs", () => {
    expect(attachmentUri({ uri: "file:///a.md" })).toBe("file:///a.md");
    expect(attachmentUri({ source: { type: "uri", uri: "file:///b.md" } })).toBe("file:///b.md");
    expect(attachmentUri({ source: { type: "inline" } })).toBe("");
  });
});
