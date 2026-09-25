// Backend ``/config`` response shape. We only type the fields we
// use on the frontend; unknown fields from the server are ignored.
export interface ConfigResponse {
  agent?: { name?: string };
  tools?: string[];
  stt_enabled?: boolean;
  plugins?: Array<{
    id: string;
    panel_component_id?: string;
    panel_entry?: { label?: string; component_id?: string };
    taskbar_entry?: unknown;
    tool_to_panel?: unknown;
  }>;
  websites?: Array<{
    id: string;
    label: string;
    url: string;
  }>;
}

// In dev the Vite proxy forwards ``/api/*`` and ``/config`` to the
// backend (configured in ``vite.config.ts``); in prod the FastAPI
// server serves the built frontend directly, so ``/config``
// resolves to the same origin.
const CONFIG_URL = "/config";

/** Fetch the server-side configuration. Throws on network or HTTP
 * failure so callers can fall back to a sensible default. */
export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch(CONFIG_URL);
  if (!res.ok) {
    throw new Error(`/config request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ConfigResponse;
}