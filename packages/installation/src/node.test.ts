import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  aes50Channel,
  aes50ChannelsByEndpoint,
  buildOutputRouteIndex,
  deriveStaticEdges,
  destination,
  endpointId,
  panelInput,
} from "@x32/domain";
import { describe, expect, it } from "vitest";

import { loadInstallationFile } from "./node";

/** The repo's real `config/installation.yaml`, not a fixture copy. */
const VENUE_CONFIG = fileURLToPath(
  new URL("../../../config/installation.yaml", import.meta.url),
);

/**
 * Only the *confirmed* facts of docs/installation.md are asserted here. The
 * passive panels and their cabling are placeholders that the docs promise can
 * be replaced by a YAML-only edit, so nothing below may depend on them;
 * mapping and derivation are covered against the fixture in `parse.test.ts`.
 */
describe("loadInstallationFile", () => {
  it("loads and validates the venue configuration", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);

    expect(
      installation.devices
        .filter((device) => device.kind === "stagebox")
        .map((device) => ({
          id: device.id,
          inputs: device.inputs,
          aes50: device.aes50,
        })),
    ).toEqual([
      { id: "stagebox-1", inputs: 16, aes50: { bus: "A", offset: 0 } },
      { id: "stagebox-2", inputs: 16, aes50: { bus: "A", offset: 16 } },
    ]);
  });

  it("declares MK Front H with 8 inputs, socket 1 annotated broken (issue #12)", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);
    const frontRight = installation.devices.find(
      (device) => device.id === "front-right",
    );

    expect(frontRight?.inputs).toBe(8);
    expect(frontRight?.sockets).toEqual([{ input: 1, status: "broken", note: "Defekt — ikke i bruk" }]);
  });

  it("resolves MK Front H's renumbering: socket 2 -> A18, socket 8 -> A24", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);
    const map = aes50ChannelsByEndpoint(installation);

    expect(map.get(endpointId(panelInput("front-right", 2)))).toEqual(
      aes50Channel("A", 18),
    );
    expect(map.get(endpointId(panelInput("front-right", 8)))).toEqual(
      aes50Channel("A", 24),
    );
  });

  it("reaches no AES50 channel from the broken socket 1", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);
    const map = aes50ChannelsByEndpoint(installation);

    expect(map.has(endpointId(panelInput("front-right", 1)))).toBe(false);
  });

  it("derives the cascade: stagebox-2 input 7 is AES50-A 23", () => {
    const edges = deriveStaticEdges(loadInstallationFile(VENUE_CONFIG));

    expect(
      edges.map((edge) => ({
        from: endpointId(edge.from),
        to: endpointId(edge.to),
      })),
    ).toContainEqual({ from: "stagebox:stagebox-2:7", to: "aes50:A:23" });
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

/**
 * The output side (issue #9). Loads the real `config/installation.yaml`
 * against docs/installation.md §"Output topology" and traces two routes
 * end to end through the domain, exactly as the UI's hover/select would.
 */
describe("loadInstallationFile: output side", () => {
  it("carries the venue's 11 destinations and both stageboxes' outputBlocks", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);

    const destinations = installation.devices.filter(
      (device) => device.kind === "destination",
    );
    expect(destinations).toHaveLength(11);
    expect(destinations.every((device) => device.inputs === 0)).toBe(true);
    expect(destinations.map((device) => device.id).sort()).toEqual(
      [
        "bak-hoyre",
        "front-hoyre",
        "front-venstre",
        "main-left",
        "main-right",
        "piano-hoyre",
        "piano-venstre",
        "sidesal",
        "sub",
        "venstre-bak",
        "vip-rom",
      ].sort(),
    );

    const stageboxes = installation.devices.filter(
      (device) => device.kind === "stagebox",
    );
    expect(stageboxes.map((device) => ({ id: device.id, outputBlock: device.outputBlock }))).toEqual([
      { id: "stagebox-1", outputBlock: { start: 9 } },
      { id: "stagebox-2", outputBlock: { start: 1 } },
    ]);
  });

  it("carries the venue's 11 output connections", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);

    const outputConnections = installation.connections.filter(
      (edge) => edge.to.kind === "destination",
    );
    expect(outputConnections).toHaveLength(11);
  });

  it("resolves Out 13 -> stagebox-1 out 5 -> front-venstre", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);
    const index = buildOutputRouteIndex(installation, []);

    const route = index.byMixerOutput.get(13);
    expect(route?.endpoints).toEqual([
      "out:13",
      "stagebox-out:stagebox-1:5",
      "dest:front-venstre",
    ]);
    expect(route?.destinations).toEqual([destination("front-venstre")]);
  });

  it("resolves Out 1 -> console-out:1 -> sidesal", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);
    const index = buildOutputRouteIndex(installation, []);

    const route = index.byMixerOutput.get(1);
    // Out 1 is presented both on the console XLR (declared) and wholesale on
    // Stagebox H's block (derived, outputBlock.start = 1) — both physical
    // outs appear alongside the destination.
    expect(route?.endpoints).toContain("console-out:1");
    expect(route?.endpoints).toContain("dest:sidesal");
    expect(route?.destinations).toEqual([destination("sidesal")]);
  });
});

/**
 * Comments legitimately mention `node:fs`, so the guard below reads code only.
 * Crude but sufficient: string literals in these modules contain no comment
 * markers.
 */
function codeOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("the browser-safe entry point", () => {
  // `node.ts` is the only module here allowed to reach for Node. A stray
  // builtin or global elsewhere would break the web bundle, and nothing else
  // in the build would catch it: `types: ["node"]` covers the whole package.
  it.each(["index.ts", "parse.ts", "schema.ts"])(
    "%s reaches for nothing Node-only",
    (file) => {
      const code = codeOf(file);

      // Any specifier form: static import, `import()`, `require()`.
      expect(code).not.toMatch(/["']node:/);
      expect(code).not.toMatch(/\b(?:process|Buffer|__dirname|__filename)\b/);
    },
  );

  it("guards a module that does reach for Node", () => {
    // Proves the guard above can fail rather than passing vacuously.
    expect(codeOf("node.ts")).toMatch(/["']node:/);
  });
});
