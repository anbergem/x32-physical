/**
 * The gateway boundary (architecture.md §6).
 *
 * The web app talks to a narrow `MixerGateway`: a lifecycle, nothing else.
 * Everything a gateway receives is pushed straight into the store, so no
 * component ever holds a `MixerClient`, a socket, or a mode flag — and nothing
 * outside this module knows which mode is active.
 */

/**
 * `mock` runs a `MockMixerClient` in the browser; `live` will connect to the
 * bridge over WebSocket (plan step 9).
 */
export type GatewayMode = "mock" | "live";

export const DEFAULT_GATEWAY_MODE: GatewayMode = "mock";

/**
 * The build-time fallback for `DEFAULT_GATEWAY_MODE`: `VITE_DEFAULT_MODE`
 * (plan step 16). The release build sets it to `live` so a venue deployment
 * defaults to the real bridge without a `?mode=` param; dev builds leave it
 * unset and keep the mock default above.
 */
function resolveDefaultGatewayMode(env: Pick<ImportMetaEnv, "VITE_DEFAULT_MODE">): GatewayMode {
  return env.VITE_DEFAULT_MODE === "live" ? "live" : DEFAULT_GATEWAY_MODE;
}

export interface MixerGateway {
  /** Applies the initial snapshot, then streams events until disconnected. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Blesses the current live snapshot as the new baseline (architecture.md
   * §7). Fire-and-forget: `WebSocketMixerGateway` sends `save-baseline` over
   * the socket and the bridge answers asynchronously with `baseline-changed`
   * or `baseline-save-rejected`; `LocalMockGateway` persists synchronously to
   * its `BaselineStore`. Neither path writes to the mixer (CLAUDE.md
   * invariant 5) — this only ever touches the bridge's disk or the browser's
   * own storage.
   */
  saveBaseline(): void;
}

/**
 * Startup mode from the page's query string (`?mode=live`), falling back to
 * the build-time default (`VITE_DEFAULT_MODE`, mock unless the release build
 * sets it) — an unrecognised `?mode=` value falls back the same way rather
 * than failing to boot. Mock stays the dev default so the app always starts
 * without an X32 (MVP criterion 1); mock mode is unmistakable on screen
 * anyway.
 */
export function resolveGatewayMode(
  search: string,
  env: Pick<ImportMetaEnv, "VITE_DEFAULT_MODE"> = import.meta.env,
): GatewayMode {
  const requested = new URLSearchParams(search).get("mode");
  return requested === "live" || requested === "mock"
    ? requested
    : resolveDefaultGatewayMode(env);
}
