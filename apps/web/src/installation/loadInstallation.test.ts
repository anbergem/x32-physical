/**
 * `loadInstallation` (issue #3, reshaped by issue #26): the bridge's
 * `/api/installation` is the *only* source of topology, so every failure is a
 * startup failure rather than a quiet fall back to a bundled copy. A real
 * `fetch` is never exercised here — every test injects one, per the module's
 * own `LoadInstallationOptions`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { INSTALLATION_ERROR_HINT, loadInstallation } from "./loadInstallation";

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
  it("parses the fetched document", async () => {
    const fetchImpl = fetchResolvingTo({
      ok: true,
      status: 200,
      text: () => Promise.resolve(VALID_YAML),
    });

    const installation = await loadInstallation({ fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/installation");
    expect(installation.devices.map((d) => d.id)).toContain("stagebox-1");
  });

  it("fetch rejects: throws, naming the endpoint and keeping the cause", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    await expect(loadInstallation({ fetch: fetchImpl })).rejects.toThrow(
      /Could not reach \/api\/installation/,
    );
    await expect(loadInstallation({ fetch: fetchImpl })).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "network down" }),
    });
  });

  it("non-200: throws rather than rendering some other installation", async () => {
    const fetchImpl = fetchResolvingTo({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
    });

    await expect(loadInstallation({ fetch: fetchImpl })).rejects.toThrow(/returned 404/);
  });

  it("200 with an unparseable body: throws, carrying the parser's own message", async () => {
    const fetchImpl = fetchResolvingTo({
      ok: true,
      status: 200,
      text: () => Promise.resolve("not: [valid, installation, shape"),
    });

    await expect(loadInstallation({ fetch: fetchImpl })).rejects.toThrow(
      /not a valid installation/,
    );
  });

  it("fetches in dev too — no environment branch is left to skip it", async () => {
    // Under `vite dev` the same request is proxied to the bridge
    // (apps/web/vite.config.ts); there is no second code path to take.
    const fetchImpl = fetchResolvingTo({
      ok: true,
      status: 200,
      text: () => Promise.resolve(VALID_YAML),
    });

    await loadInstallation({ fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("points the operator at the bridge, not at a file they cannot see", () => {
    expect(INSTALLATION_ERROR_HINT).toMatch(/service/i);
    expect(INSTALLATION_ERROR_HINT).toMatch(/installation\.yaml/);
  });
});

/**
 * The bundled fallback is gone for good (issue #26): a build-time copy of one
 * venue's wiring, rendered confidently whenever the bridge is unreachable, is
 * a worse failure than an honest error — and it is what kept
 * `config/installation.yaml` from being gitignorable (issue #24). Asserted
 * against the module's own source, because the thing being ruled out is an
 * *import*, which no behavioural test can observe.
 */
describe("no bundled installation copy", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./loadInstallation.ts", import.meta.url)),
    "utf8",
  );

  it("does not import any file as raw text", () => {
    expect(source).not.toMatch(/^\s*import .*\?raw/m);
  });

  it("does not reach out of the app into config/", () => {
    expect(source).not.toMatch(/^\s*import .*config\/installation/m);
  });
});
