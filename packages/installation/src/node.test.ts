import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveStaticEdges, endpointId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { loadInstallationFile } from "./node";

/** The repo's real `config/installation.yaml`, not a fixture copy. */
const VENUE_CONFIG = fileURLToPath(
  new URL("../../../config/installation.yaml", import.meta.url),
);

describe("loadInstallationFile", () => {
  it("loads the venue configuration through the whole pipeline", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);

    expect(installation.devices.map((device) => device.id)).toEqual([
      "stagebox-1",
      "stagebox-2",
      "front-left",
      "front-right",
    ]);

    // The confirmed cascade: both boxes on AES50-A, offsets 0 and 16.
    expect(
      installation.devices
        .filter((device) => device.kind === "stagebox")
        .map((device) => device.aes50),
    ).toEqual([
      { bus: "A", offset: 0 },
      { bus: "A", offset: 16 },
    ]);
  });

  it("derives the cascade offsets: stagebox-2 input 7 is AES50-A 23", () => {
    const edges = deriveStaticEdges(loadInstallationFile(VENUE_CONFIG));
    const ids = edges.map((edge) => ({
      from: endpointId(edge.from),
      to: endpointId(edge.to),
    }));

    expect(ids).toContainEqual({
      from: "stagebox:stagebox-2:7",
      to: "aes50:A:23",
    });

    // …and the placeholder cabling that feeds it, so the chain is complete:
    // front-right 7 → stagebox-2 7 → AES50-A 23.
    expect(ids).toContainEqual({
      from: "panel:front-right:7",
      to: "stagebox:stagebox-2:7",
    });

    // 16 cabled panel sockets + 32 derived stagebox→AES50 edges.
    expect(edges).toHaveLength(48);
  });

  it("names the file when it cannot be read", () => {
    const missing = fileURLToPath(
      new URL("../../../config/does-not-exist.yaml", import.meta.url),
    );

    expect(() => loadInstallationFile(missing)).toThrow(
      /Cannot read installation file .*does-not-exist\.yaml/,
    );
  });

  it("names the file path in validation errors", () => {
    const notYaml = fileURLToPath(new URL("./node.ts", import.meta.url));

    expect(() => loadInstallationFile(notYaml)).toThrow(/node\.ts/);
  });
});

describe("the browser-safe entry point", () => {
  // `node.ts` is the only module in this package allowed to reach for a Node
  // builtin; a stray `node:fs` import elsewhere would break the web bundle,
  // which nothing else in the build would catch.
  it.each(["index.ts", "parse.ts", "schema.ts"])(
    "%s imports no Node builtin",
    (file) => {
      const source = readFileSync(
        fileURLToPath(new URL(`./${file}`, import.meta.url)),
        "utf8",
      );

      expect(source).not.toMatch(/from\s+["']node:/);
    },
  );
});
