import { deriveStaticEdges, endpointId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { parseInstallationYaml } from "./parse";

/**
 * A small but complete valid document, edited per test to break exactly one
 * thing. Mirrors the venue: two cascaded stageboxes plus one passive panel.
 */
const VALID_YAML = `version: 1

devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  stagebox-2:
    kind: stagebox
    label: "Stagebox 2"
    inputs: 16
    aes50: { bus: A, offset: 16 }

  front-left:
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections:
  - from: { device: front-left, input: 1 }
    to: { device: stagebox-1, input: 1 }
  - from: { device: front-left, input: 8 }
    to: { device: stagebox-2, input: 7 }
`;

/** Targeted edit of the valid document; fails loudly if the anchor moved. */
function edited(anchor: string, replacement: string): string {
  expect(VALID_YAML).toContain(anchor);
  return VALID_YAML.replace(anchor, replacement);
}

/** The message of the error a broken document produces. */
function failureOf(yaml: string, source?: string): string {
  try {
    parseInstallationYaml(yaml, source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseInstallationYaml to throw, but it returned");
}

describe("parseInstallationYaml", () => {
  it("maps a valid document into a domain installation", () => {
    const installation = parseInstallationYaml(VALID_YAML);

    expect(installation.devices.map((device) => device.id)).toEqual([
      "stagebox-1",
      "stagebox-2",
      "front-left",
    ]);

    expect(
      installation.devices.find((device) => device.id === "stagebox-2"),
    ).toEqual({
      id: "stagebox-2",
      kind: "stagebox",
      label: "Stagebox 2",
      inputs: 16,
      aes50: { bus: "A", offset: 16 },
    });
  });

  it("leaves a passive panel without an aes50 mapping", () => {
    const installation = parseInstallationYaml(VALID_YAML);
    const panel = installation.devices.find(
      (device) => device.id === "front-left",
    );

    expect(panel).toEqual({
      id: "front-left",
      kind: "passive-panel",
      label: "Front Left",
      inputs: 8,
    });
    expect(panel).not.toHaveProperty("aes50");
  });

  it("turns connection endpoints into panel/stagebox endpoint refs", () => {
    const installation = parseInstallationYaml(VALID_YAML);

    expect(installation.connections).toEqual([
      {
        from: { kind: "panel-input", device: "front-left", input: 1 },
        to: { kind: "stagebox-input", device: "stagebox-1", input: 1 },
      },
      {
        from: { kind: "panel-input", device: "front-left", input: 8 },
        to: { kind: "stagebox-input", device: "stagebox-2", input: 7 },
      },
    ]);
  });

  it("derives no AES50 edges into `connections` (the domain does that)", () => {
    const installation = parseInstallationYaml(VALID_YAML);

    expect(installation.connections).toHaveLength(2);
    expect(
      installation.connections.some(
        (connection) => connection.to.kind === "aes50-channel",
      ),
    ).toBe(false);
  });

  it("yields an installation the domain can derive the cascade from", () => {
    const ids = deriveStaticEdges(parseInstallationYaml(VALID_YAML)).map(
      (edge) => ({ from: endpointId(edge.from), to: endpointId(edge.to) }),
    );

    // The cascade in full: front-left 8 → stagebox-2 7 → AES50-A 23 (16 + 7).
    expect(ids).toContainEqual({
      from: "panel:front-left:8",
      to: "stagebox:stagebox-2:7",
    });
    expect(ids).toContainEqual({
      from: "stagebox:stagebox-2:7",
      to: "aes50:A:23",
    });

    // 2 cabled panel sockets + 32 derived stagebox→AES50 edges.
    expect(ids).toHaveLength(34);
  });

  describe("YAML layer", () => {
    it("reports a syntax error, naming the source and the location", () => {
      const message = failureOf(
        edited('    label: "Stagebox 1"', '    label: "Stagebox 1'),
        "venue.yaml",
      );

      expect(message).toContain("YAML syntax error in venue.yaml");
      expect(message).toMatch(/line \d+/);
    });

    it("rejects a duplicated device key", () => {
      const message = failureOf(
        edited("  front-left:\n    kind: passive-panel", "  stagebox-1:\n    kind: passive-panel"),
      );

      expect(message).toContain("YAML syntax error in installation.yaml");
      expect(message).toMatch(/unique/i);
    });
  });

  describe("schema layer", () => {
    it("rejects an unknown schema version", () => {
      const message = failureOf(edited("version: 1", "version: 2"));

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("version");
    });

    it("names the path of a missing field", () => {
      const message = failureOf(edited("    inputs: 8\n", ""));

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("devices.front-left.inputs");
    });

    it("names the path of a wrongly typed field", () => {
      const message = failureOf(edited("    inputs: 8", '    inputs: "eight"'));

      expect(message).toContain("devices.front-left.inputs");
      expect(message).toMatch(/number/i);
    });

    it("rejects an aes50 mapping on a passive panel", () => {
      const message = failureOf(
        edited("    inputs: 8", "    inputs: 8\n    aes50: { bus: B, offset: 32 }"),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("devices.front-left");
      expect(message).toContain("aes50");
    });

    it("rejects a stagebox with no aes50 mapping", () => {
      const message = failureOf(edited("    aes50: { bus: A, offset: 0 }\n", ""));

      expect(message).toContain("devices.stagebox-1.aes50");
    });

    it("rejects an unknown AES50 bus", () => {
      const message = failureOf(edited("{ bus: A, offset: 0 }", "{ bus: C, offset: 0 }"));

      expect(message).toContain("devices.stagebox-1.aes50.bus");
    });

    it("rejects a negative AES50 offset", () => {
      const message = failureOf(edited("{ bus: A, offset: 0 }", "{ bus: A, offset: -1 }"));

      expect(message).toContain("devices.stagebox-1.aes50.offset");
    });

    it("rejects a device id that is not kebab-case", () => {
      const message = failureOf(edited("  front-left:", "  Front_Left:"));

      expect(message).toContain("kebab-case");
    });

    it("rejects an unknown key instead of ignoring it", () => {
      const message = failureOf(
        edited("connections:", "coordinates: { x: 10, y: 20 }\n\nconnections:"),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("coordinates");
    });

    it("names the path inside a connection", () => {
      const message = failureOf(
        edited("to: { device: stagebox-2, input: 7 }", "to: { device: stagebox-2 }"),
      );

      expect(message).toContain("connections[1].to.input");
    });
  });

  describe("topology layer", () => {
    it("surfaces the domain message for overlapping AES50 ranges", () => {
      const message = failureOf(
        edited("{ bus: A, offset: 16 }", "{ bus: A, offset: 8 }"),
        "venue.yaml",
      );

      expect(message).toContain("Invalid installation topology in venue.yaml");
      expect(message).toContain("stagebox-1");
      expect(message).toContain("stagebox-2");
      expect(message).toMatch(/overlap/);
    });

    it("surfaces the domain message for a range that overruns the bus", () => {
      const message = failureOf(edited("{ bus: A, offset: 16 }", "{ bus: A, offset: 40 }"));

      expect(message).toContain("Invalid installation topology");
      expect(message).toMatch(/exceeds the bus range/);
    });

    it("surfaces the domain message for a device with no inputs", () => {
      const message = failureOf(edited("    inputs: 8", "    inputs: 0"));

      expect(message).toContain("Invalid installation topology");
      expect(message).toContain("front-left");
    });

    it("reports a zero socket as shape and an unknown device as topology", () => {
      const unknownDevice = edited(
        "  - from: { device: front-left, input: 1 }",
        "  - from: { device: front-right, input: 1 }",
      );

      // A socket number below 1 is shape-invalid, so it never reaches the
      // domain: Zod stops the file while the unknown device is still unseen.
      const withZeroSocket = unknownDevice.replace(
        "to: { device: stagebox-2, input: 7 }",
        "to: { device: stagebox-2, input: 0 }",
      );
      const shapeFailure = failureOf(withZeroSocket);

      expect(shapeFailure).toContain("Invalid installation schema");
      expect(shapeFailure).toContain("connections[1].to.input");
      expect(shapeFailure).not.toContain("front-right");

      // With the shape sound, the domain reports the unknown device itself.
      const topologyFailure = failureOf(unknownDevice);

      expect(topologyFailure).toContain("Invalid installation topology");
      expect(topologyFailure).toContain("Connection #1");
      expect(topologyFailure).toContain("unknown device");
      expect(topologyFailure).toContain("front-right");
    });

    it("surfaces the domain message for a reversed connection", () => {
      const message = failureOf(
        edited(
          "  - from: { device: front-left, input: 1 }\n    to: { device: stagebox-1, input: 1 }",
          "  - from: { device: stagebox-1, input: 1 }\n    to: { device: front-left, input: 1 }",
        ),
      );

      expect(message).toContain("Invalid installation topology");
      expect(message).toContain("Connection #1");
    });

    it("fails on the first broken layer only", () => {
      // Both a schema violation (bad bus) and a topology violation (overlap).
      const message = failureOf(
        edited("{ bus: A, offset: 16 }", "{ bus: C, offset: 8 }"),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).not.toContain("overlap");
    });
  });
});
