import { readFileSync } from "node:fs";
import {
  AUTH_SCHEMES,
  DEFAULT_BASE_URLS,
  LANGUAGETOOL_AUTH,
  SECRET_HEADER_NAMES,
} from "@typely/provider-adapters";
import { describe, expect, it } from "vitest";
import { AppSettingsSchema, defaultSettings } from "../src/settings.ts";

// The Rust executor checks the same fixtures (src-tauri/src/endpoints.rs and settings.rs).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../src-tauri/tests/fixtures/${name}`, import.meta.url), "utf8"));

describe("Rust contract", () => {
  it("auth schemes and default base URLs match the Rust table", () => {
    expect(fixture("endpoints-contract.json")).toEqual({
      auth_schemes: AUTH_SCHEMES,
      default_base_urls: Object.fromEntries(
        Object.entries(DEFAULT_BASE_URLS).map(([kind, url]) => [kind, url ?? null]),
      ),
      languagetool_auth: LANGUAGETOOL_AUTH,
      secret_header_names: [...SECRET_HEADER_NAMES],
    });
  });

  it("the settings fixture is already in normalised Zod form", () => {
    const json = fixture("settings.json");
    expect(AppSettingsSchema.parse(json)).toEqual(json);
  });

  it("defaults are local only", () => {
    const settings = defaultSettings();
    expect(settings.engine.providers).toEqual([]);
    expect(settings.engine.privacy.cloud_processing_allowed).toBe(false);
    expect(settings.desktop.shortcut).toBe("Ctrl+Shift+Space");
  });
});
