import { beforeEach, describe, expect, test, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock("obsidian", () => ({ requestUrl }));

import {
  normalizeBaseUrl,
  OpenCodeApiError,
  OpenCodeClient,
  redeemPairingCode,
} from "../src/api/client";

function ok(body: unknown, status = 200): { status: number; text: string } {
  return { status, text: body === undefined ? "" : JSON.stringify(body) };
}

function client(workspaceDirectory = ""): OpenCodeClient {
  return new OpenCodeClient({
    baseUrl: "http://192.168.1.20:49374/",
    username: "opencode",
    password: "token",
    workspaceDirectory,
  });
}

describe("OpenCodeClient", () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  test("normalizes bare host names and trailing slashes", () => {
    expect(normalizeBaseUrl(" 192.168.1.20:49374/ ")).toBe("http://192.168.1.20:49374");
    expect(normalizeBaseUrl("https://example.com/opencode/")).toBe("https://example.com/opencode");
    expect(normalizeBaseUrl("")).toBe("");
  });

  test("normalizes the base URL and sends basic auth", async () => {
    requestUrl.mockResolvedValue(ok({ version: "2.2.5", pid: 1, urls: [], paths: { tmp: "/tmp" } }));

    await client().info();

    const request = requestUrl.mock.calls[0]?.[0];
    expect(request.url).toBe("http://192.168.1.20:49374/api/info");
    expect(request.headers.Authorization).toMatch(/^Basic /);
  });

  test("encodes the workspace as a deep location query", async () => {
    requestUrl.mockResolvedValue(ok({ location: { directory: "/vault" }, data: [] }));

    await client("/vault").findFiles("daily", 10);

    const request = requestUrl.mock.calls[0]?.[0];
    expect(request.url).toContain("location%5Bdirectory%5D=%2Fvault");
    expect(request.url).toContain("query=daily");
    expect(request.url).toContain("type=file");
  });

  test("asks for the newest message page and returns it chronologically", async () => {
    requestUrl.mockResolvedValue(
      ok({
        data: [
          { id: "newer", type: "system", time: { created: 2 }, text: "b" },
          { id: "older", type: "system", time: { created: 1 }, text: "a" },
        ],
        cursor: {},
      }),
    );

    const response = await client().messages("ses_1", 10);

    expect(requestUrl.mock.calls[0]?.[0].url).toContain("order=desc");
    expect(response.data.map((message) => message.id)).toEqual(["older", "newer"]);
  });

  test("sends an empty object when compacting", async () => {
    requestUrl.mockResolvedValue(ok(undefined, 204));

    await client().compact("ses_1");

    const request = requestUrl.mock.calls[0]?.[0];
    expect(request.method).toBe("POST");
    expect(request.body).toBe("{}");
  });

  test("maps HTTP errors to readable messages", async () => {
    requestUrl.mockResolvedValue({
      status: 401,
      text: JSON.stringify({ message: "nope" }),
    });

    await expect(client().sessions()).rejects.toBeInstanceOf(OpenCodeApiError);
    await expect(client().sessions()).rejects.toThrow(/Authentication failed/);
  });

  test("redeems a pairing code with an explicit JSON accept header", async () => {
    requestUrl.mockResolvedValue(ok({ token: "session-token" }));

    await expect(redeemPairingCode("http://host:49374/", "abc_DEF-123")).resolves.toBe(
      "session-token",
    );
    const request = requestUrl.mock.calls[0]?.[0];
    expect(request.url).toBe("http://host:49374/auth/connect/abc_DEF-123");
    expect(request.headers.Accept).toBe("application/json");
  });
});
