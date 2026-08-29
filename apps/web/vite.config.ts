import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The bridge's own port in development (`DEFAULT_PORT` in
 * `apps/x32-bridge/src/config.ts`, mirrored by `DEFAULT_BRIDGE_PORT` in
 * `apps/web/src/gateway/webSocketMixerGateway.ts`).
 */
const BRIDGE_PORT = 8765;

export default defineConfig({
  plugins: [react()],
  server: {
    /**
     * The venue topology is served by the bridge and only by the bridge
     * (issue #26 — the app no longer bundles a copy of anyone's wiring). In a
     * release build one port serves both the app and `GET /api/installation`,
     * so `loadInstallation` always fetches a same-origin path; in dev the two
     * are separate processes, and this forwards that same path to the
     * bridge's port. Run `pnpm bridge` alongside `pnpm dev` — a mock mixer
     * behind it still needs no X32 (CLAUDE.md invariant 4).
     */
    proxy: {
      "/api": { target: `http://localhost:${BRIDGE_PORT}` },
    },
  },
});
