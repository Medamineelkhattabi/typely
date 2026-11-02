import type { ProviderKind } from "@typely/schemas";
import type { AuthScheme } from "./types.ts";

export const DEFAULT_BASE_URLS: Readonly<Record<ProviderKind, string | undefined>> = {
  openai: "https://api.openai.com/v1",
  openai_compatible: undefined,
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://localhost:11434",
};

/** Auth scheme per provider kind. The Rust executor mirrors this table. */
export const AUTH_SCHEMES: Readonly<Record<ProviderKind, AuthScheme>> = {
  openai: { type: "bearer", optional: false },
  openai_compatible: { type: "bearer", optional: true },
  anthropic: { type: "header", name: "x-api-key", optional: false },
  // Header rather than the `?key=` query parameter so keys never appear in URLs or logs.
  gemini: { type: "header", name: "x-goog-api-key", optional: false },
  ollama: { type: "none" },
};

export const LANGUAGETOOL_AUTH: AuthScheme = { type: "form_field", name: "apiKey", optional: true };

/** Header names that only a transport may set. */
export const SECRET_HEADER_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "api-key",
]);

export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Joins a base URL and a relative path, refusing anything that could change the origin
 * or escape the base path. This is what keeps a secret bound to its configured host.
 */
export function joinEndpointUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error(`Invalid endpoint path '${path}'`);
  }
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const joined = new URL(`${base.origin}${basePath}${path}`);
  if (joined.origin !== base.origin || !joined.pathname.startsWith(`${basePath}/`)) {
    throw new Error(`Endpoint path '${path}' escapes base URL`);
  }
  return joined;
}
