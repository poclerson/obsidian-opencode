import { describe, expect, test } from "vitest";
import { parsePairingLink, parseServerUrl } from "../src/api/pairing";

describe("parsePairingLink", () => {
  test("reads the server address and code from an opencode pair link", () => {
    expect(parsePairingLink(" http://192.168.1.2:49374/auth/connect/abc_DEF-123 ")).toEqual({
      serverUrl: "http://192.168.1.2:49374",
      code: "abc_DEF-123",
    });
  });

  test("keeps a reverse-proxy path prefix", () => {
    expect(parsePairingLink("https://example.com/opencode/auth/connect/abc")).toEqual({
      serverUrl: "https://example.com/opencode",
      code: "abc",
    });
  });

  test("reads the QR JSON payload", () => {
    expect(
      parsePairingLink(
        JSON.stringify({ code: "abc_DEF-123", urls: ["http://192.168.1.2:49374", "http://100.64.0.3:49374"] }),
      ),
    ).toEqual({ serverUrl: "http://192.168.1.2:49374", code: "abc_DEF-123" });
  });

  test("rejects malformed links", () => {
    expect(parsePairingLink("http://192.168.1.2:49374/auth/connect/")).toBeUndefined();
    expect(parsePairingLink("http://192.168.1.2:49374/auth/connect/abc/extra")).toBeUndefined();
    expect(parsePairingLink("opencode-ios://auth/connect/abc")).toBeUndefined();
    expect(parsePairingLink("192.168.1.2:49374")).toBeUndefined();
    expect(parsePairingLink(JSON.stringify({ code: "a/b", urls: ["http://host:1"] }))).toBeUndefined();
  });
});

describe("parseServerUrl", () => {
  test("adds http to a bare host", () => {
    expect(parseServerUrl("192.168.1.2:4096")).toBe("http://192.168.1.2:4096");
    expect(parseServerUrl("localhost")).toBe("http://localhost");
    expect(parseServerUrl("devbox:4096/")).toBe("http://devbox:4096");
  });

  test("keeps https and path prefixes", () => {
    expect(parseServerUrl("https://opencode.example.com/base/")).toBe("https://opencode.example.com/base");
  });

  test("rejects pairing links and non-http schemes", () => {
    expect(parseServerUrl("http://host:1/auth/connect/abc")).toBe("http://host:1/auth/connect/abc");
    expect(parseServerUrl("ftp://host")).toBeUndefined();
  });
});
