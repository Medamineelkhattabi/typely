import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type AppSettings, AppSettingsSchema } from "./settings.ts";
import { type StreamMessage, type TauriBindings, TauriTransport } from "./tauri-transport.ts";

/** Typed wrappers around the Rust commands. Which window may call which is set in capabilities. */

export const tauriBindings: TauriBindings = {
  invoke: (command, args) => invoke(command, args),
  createChannel: (onMessage) => {
    const channel = new Channel<StreamMessage>();
    channel.onmessage = onMessage;
    return channel;
  },
  newRequestId: () => crypto.randomUUID(),
};

export function createTransport(): TauriTransport {
  return new TauriTransport(tauriBindings);
}

export interface SettingsView {
  settings: AppSettings;
  /** The settings file was unreadable and defaults were loaded. */
  warning?: string;
  /** The saved shortcut could not be registered at startup. */
  shortcut_error?: string;
}

export async function getSettings(): Promise<SettingsView> {
  const view = await invoke<SettingsView>("settings_get");
  return { ...view, settings: AppSettingsSchema.parse(view.settings) };
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const saved = await invoke<unknown>("settings_save", {
    settings: AppSettingsSchema.parse(settings),
  });
  return AppSettingsSchema.parse(saved);
}

export function onSettingsChanged(callback: (settings: AppSettings) => void): Promise<UnlistenFn> {
  return listen<unknown>("settings://changed", (event) =>
    callback(AppSettingsSchema.parse(event.payload)),
  );
}

/** A key's state; the key itself never leaves Rust. */
export type SecretState = "missing" | "stored" | "origin_changed";

export const secretStatus = () => invoke<Record<string, SecretState>>("secret_status");
export const setSecret = (endpointId: string, secret: string) =>
  invoke<void>("secret_set", { endpointId, secret });
export const deleteSecret = (endpointId: string) => invoke<void>("secret_delete", { endpointId });

export interface OllamaStatus {
  base_url: string;
  running: boolean;
  version?: string;
  models: { name: string; size_bytes: number }[];
  loaded: string[];
  total_memory_bytes: number;
  error?: string;
}

/** Lists installed and loaded models. Never loads a model. */
export const detectOllama = () => invoke<OllamaStatus>("ollama_detect");

export interface CapturePayload {
  id: number;
  text?: string;
  error?: { code: string; message: string };
  source_app?: string;
  method?: "ui_automation" | "clipboard";
  can_replace: boolean;
}

export const panelReady = () => invoke<CapturePayload | null>("panel_ready");
export const panelHide = () => invoke<void>("panel_hide");
export const panelReplace = (captureId: number, text: string) =>
  invoke<void>("panel_replace", { captureId, text });
export const panelCopy = (text: string) => invoke<void>("panel_copy", { text });

export const onCapture = (callback: (payload: CapturePayload) => void) =>
  listen<CapturePayload>("panel://capture", (event) => callback(event.payload));
export const onPanelHidden = (callback: () => void) => listen("panel://hidden", () => callback());
