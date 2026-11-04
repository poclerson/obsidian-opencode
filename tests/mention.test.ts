import { describe, expect, test } from "vitest";
import { insertMention, mentionContext, mentionForText } from "../src/util/mention";
import { encodeFilePath, fileUri, joinServerPath } from "../src/util/path";

describe("mentionContext", () => {
  test("matches an @ token", () => {
    expect(mentionContext("hello @not", 10)).toEqual({ start: 6, end: 10, query: "not" });
    expect(mentionContext("@not", 4)).toEqual({ start: 0, end: 4, query: "not" });
  });

  test("does not match emails", () => {
    expect(mentionContext("mail me@example", 15)).toBeUndefined();
  });

  test("stops at whitespace", () => {
    expect(mentionContext("@my note", 8)).toBeUndefined();
  });
});

describe("insertMention", () => {
  test("replaces the token and places the cursor after the space", () => {
    expect(insertMention("hello @no world", { start: 6, end: 9, query: "no" }, "notes/today.md")).toEqual({
      text: "hello @notes/today.md world",
      cursor: 22,
    });
  });
});

describe("mentionForText", () => {
  test("finds a path mention", () => {
    expect(mentionForText("read @notes/today.md please", "notes/today.md")).toEqual({
      start: 5,
      end: 20,
      text: "@notes/today.md",
    });
  });

  test("falls back to the basename", () => {
    expect(mentionForText("read @today.md please", "notes/today.md")).toEqual({
      start: 5,
      end: 14,
      text: "@today.md",
    });
  });

  test("returns undefined when the mention was removed", () => {
    expect(mentionForText("read the note", "notes/today.md")).toBeUndefined();
  });
});

describe("paths", () => {
  test("encodes file paths like OpenCode", () => {
    expect(encodeFilePath("/home/user/file#name with spaces.txt")).toBe(
      "/home/user/file%23name%20with%20spaces.txt",
    );
    expect(encodeFilePath("src\\components\\App.tsx")).toBe("src/components/App.tsx");
    expect(encodeFilePath("D:\\dev\\opencode\\README.md")).toBe("/D:/dev/opencode/README.md");
  });

  test("joins a server directory and a relative path", () => {
    expect(joinServerPath("/Users/me/Notes/", "/daily/today.md")).toBe("/Users/me/Notes/daily/today.md");
    expect(fileUri("/Users/me/Notes", "daily/today.md")).toBe("file:///Users/me/Notes/daily/today.md");
  });
});
