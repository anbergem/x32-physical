/**
 * `loadInstallation` (issue #3): fetch `/api/installation` with the bundled
 * `?raw` copy as fallback. A real `fetch` is never exercised here — every
 * test injects one, per the module's own `LoadInstallationOptions`.
 */

import { describe, expect, it, vi } from "vitest";

import { loadInstallation } from "./loadInstallation";

/** `env.DEV: false` — the production-build branch that actually fetches. */
const PROD_ENV: ImportMetaEnv = { DEV: false };

/** `env.DEV: true` — the dev-server branch that must never fetch. */
const DEV_ENV: ImportMetaEnv = { DEV: true };

const VALID_YAML = `version: 1

devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  front-left:
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections:
  - from: { device: front-left, input: 1 }
    to: { device: stagebox-1, input: 1 }
`;

function fetchResolvingTo(response: Partial<Response> & { text?: () => Promise<string> }): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe("loadInstallation", () => {
  it("successful fetch: parses the fetched text, bundled copy unused", async () => {
    const fetchImpl = fetchResolvingTo({
      ok: true,
      status: 200,
      text: () => Promise.resolve(VALID_YAML),
    });

    const installation = await loadInstallation({ fetch: fetchImpl, env: PROD_ENV });

    expect(fetchImpl).toHaveBeenCalledWith("/api/installation");
    expect(installation.devices.map((d) => d.id)).toContain("stagebox-1");
  });

  it("fetch rejects: falls back to the bundled copy, no throw", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const installation = await loadInstallation({ fetch: fetchImpl, env: PROD_ENV });

    expect(installation.devices.length).toBeGreaterThan(0);
  });

  it("non-200: falls back to the bundled copy", async () => {
    const fetchImpl = fetchResolvingTo({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
    });

    const installation = await loadInstallation({ fetch: fetchImpl, env: PROD_ENV });

    expect(installation.devices.length).toBeGreaterThan(0);
  });

  it("200 with an unparseable body: falls back to the bundled copy", async () => {
    const fetchImpl = fetchResolvingTo({
      ok: true,
      status: 200,
      text: () => Promise.resolve("not: [valid, installation, shape"),
    });

    const installation = await loadInstallation({ fetch: fetchImpl, env: PROD_ENV });

    expect(installation.devices.length).toBeGreaterThan(0);
  });

  it("DEV: fetch is never called, bundled copy used directly", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const installation = await loadInstallation({ fetch: fetchImpl, env: DEV_ENV });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(installation.devices.length).toBeGreaterThan(0);
  });
});
