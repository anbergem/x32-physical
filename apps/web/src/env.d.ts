/**
 * Ambient declarations for the non-TS imports the Vite build understands.
 * Declared here rather than pulled from `vite/client` so the app's tsconfig
 * keeps `"types": []` and picks up no global type surface by accident.
 */

/*
 * There is deliberately no `declare module "*?raw"` here. The app used to
 * inline `config/installation.yaml` at build time as a fallback topology;
 * issue #26 removed it (a foreign installation rendered confidently is worse
 * than an honest error) and the build no longer depends on that file
 * existing. Leaving the declaration out means a re-introduced `?raw` import
 * fails typecheck rather than quietly bundling a venue's wiring again.
 */

/** Side-effect stylesheet imports. */
declare module "*.css";

/**
 * The build-time env vars this app reads (`gateway/webSocketMixerGateway.ts`,
 * `gateway/mixerGateway.ts`): an override for the bridge's WebSocket URL, and
 * the default gateway mode baked in at build time (plan step 16 — the release
 * build sets `VITE_DEFAULT_MODE=live`). `DEV` is Vite's own built-in flag
 * (true under `vite`/`vite dev`, false in a `vite build` output) — declared
 * by hand, like the vars above, rather than pulling in all of `vite/client`'s
 * ambient types.
 */
interface ImportMetaEnv {
  readonly VITE_X32_BRIDGE_URL?: string;
  readonly VITE_DEFAULT_MODE?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
