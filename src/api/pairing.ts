export interface ParsedPairing {
  /** Server origin, including any reverse-proxy path prefix. */
  serverUrl: string;
  /** One-time pairing code. */
  code: string;
}

const CODE = /^[A-Za-z0-9_-]+$/;

function normalizeServerUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

/**
 * Accepts the formats emitted by `opencode pair`:
 *  - http://192.168.1.2:49374/auth/connect/abc_DEF-123
 *  - {"code":"abc_DEF-123","urls":["http://192.168.1.2:49374"]} (QR payload)
 *  - a bare server URL plus a code, supplied separately
 */
export function parsePairingLink(input: string): ParsedPairing | undefined {
  const value = input.trim();
  if (!value) return undefined;

  if (value.startsWith("{")) {
    try {
      const payload = JSON.parse(value) as { code?: unknown; urls?: unknown };
      if (typeof payload.code !== "string" || !CODE.test(payload.code)) return undefined;
      if (!Array.isArray(payload.urls)) return undefined;
      const urls = payload.urls.filter((url): url is string => typeof url === "string");
      for (const url of urls) {
        const serverUrl = normalizeServerUrl(url);
        if (serverUrl) return { serverUrl, code: payload.code };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;

  const match = url.pathname.match(/^(.*)\/auth\/connect\/([^/]+)$/);
  if (!match) return undefined;
  const code = decodeURIComponent(match[2] ?? "");
  if (!CODE.test(code)) return undefined;

  const prefix = (match[1] ?? "").replace(/\/+$/, "");
  return {
    serverUrl: `${url.origin}${prefix}`,
    code,
  };
}

/** Parses a server URL typed by hand. */
export function parseServerUrl(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return normalizeServerUrl(`http://${value}`);
  }
  return normalizeServerUrl(value);
}
