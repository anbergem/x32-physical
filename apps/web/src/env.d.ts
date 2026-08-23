/**
 * Ambient declarations for the non-TS imports the Vite build understands.
 * Declared here rather than pulled from `vite/client` so the app's tsconfig
 * keeps `"types": []` and picks up no global type surface by accident.
 */

/** `import text from "./file.yaml?raw"` — Vite inlines the file as a string. */
declare module "*?raw" {
  const content: string;
  export default content;
}

/** Side-effect stylesheet imports. */
declare module "*.css";

/**
 * The one build-time env var this app reads (`gateway/webSocketMixerGateway.ts`):
 * an override for the bridge's WebSocket URL. Declared by hand, like the
 * modules above, rather than pulling in all of `vite/client`'s ambient types.
 */
interface ImportMetaEnv {
  readonly VITE_X32_BRIDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
