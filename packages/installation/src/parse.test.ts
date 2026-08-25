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
    it("rejects an unsupported schema version", () => {
      const message = failureOf(edited("version: 1", "version: 3"));

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("version");
    });

    it("accepts version: 2 with no output content (tolerance rule)", () => {
      const installation = parseInstallationYaml(edited("version: 1", "version: 2"));

      expect(installation.devices).toHaveLength(3);
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
        edited(
          "to: { device: stagebox-2, input: 7 }",
          'to: { device: stagebox-2, input: "seven" }',
        ),
      );

      expect(message).toContain("connections[1].to.input");
    });

    it("passes a `to` with only `device` through shape validation unrejected", () => {
      // `{ device }` alone is now shape-valid (the destination form). This
      // document's `stagebox-2` is a stagebox, not a destination, so it is
      // rejected — but by the *domain* layer (device-kind-mismatch), not
      // here, proving the shape layer no longer treats a bare `device` as
      // malformed.
      const message = failureOf(
        edited("to: { device: stagebox-2, input: 7 }", "to: { device: stagebox-2 }"),
      );

      expect(message).toContain("Invalid installation topology");
      expect(message).toContain("destination");
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

/**
 * The output side (issue #9): a self-contained fixture with one stagebox
 * presenting a block, one console XLR out, and two destinations — small
 * enough to isolate the new schema/mapping surface from the input-side
 * fixture above.
 */
const OUTPUT_YAML = `version: 2

devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 8
    aes50: { bus: A, offset: 0 }
    outputs: 8
    outputBlock: { start: 9 }

  main-left:
    kind: destination
    label: "Main Left"

  sidesal:
    kind: destination
    label: "Sidesal"

connections:
  - from: { device: stagebox-1, output: 7 }
    to: { device: main-left }
  - from: { consoleOutput: 1 }
    to: { device: sidesal }
`;

function outputEdited(anchor: string, replacement: string): string {
  expect(OUTPUT_YAML).toContain(anchor);
  return OUTPUT_YAML.replace(anchor, replacement);
}

function outputFailureOf(yaml: string): string {
  try {
    parseInstallationYaml(yaml);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseInstallationYaml to throw, but it returned");
}

describe("parseInstallationYaml: output side", () => {
  it("maps a stagebox's outputs and outputBlock", () => {
    const installation = parseInstallationYaml(OUTPUT_YAML);
    const stagebox = installation.devices.find(
      (device) => device.id === "stagebox-1",
    );

    expect(stagebox).toMatchObject({ outputs: 8, outputBlock: { start: 9 } });
  });

  it("gives a destination device inputs: 0 without it ever being authored", () => {
    const installation = parseInstallationYaml(OUTPUT_YAML);
    const mainLeft = installation.devices.find((device) => device.id === "main-left");

    expect(mainLeft).toEqual({
      id: "main-left",
      kind: "destination",
      label: "Main Left",
      inputs: 0,
    });
  });

  it("maps stagebox-output → destination and console-output → destination", () => {
    const installation = parseInstallationYaml(OUTPUT_YAML);

    expect(installation.connections).toContainEqual({
      from: { kind: "stagebox-output", device: "stagebox-1", output: 7 },
      to: { kind: "destination", device: "main-left" },
    });
    expect(installation.connections).toContainEqual({
      from: { kind: "console-output", output: 1 },
      to: { kind: "destination", device: "sidesal" },
    });
  });

  it("derives the console XLR's identity edge from mixer-output, never authored in YAML", () => {
    const installation = parseInstallationYaml(OUTPUT_YAML);

    expect(installation.connections).toContainEqual({
      from: { kind: "mixer-output", output: 1 },
      to: { kind: "console-output", output: 1 },
    });
  });

  it("loads a version: 1 file with no output content (regression guard)", () => {
    const installation = parseInstallationYaml(
      `version: 1

devices:
  front-left:
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections: []
`,
    );

    expect(installation.devices).toEqual([
      { id: "front-left", kind: "passive-panel", label: "Front Left", inputs: 8 },
    ]);
  });

  describe("shape rejections", () => {
    it("rejects a destination carrying inputs", () => {
      const message = outputFailureOf(
        outputEdited('    label: "Main Left"', '    label: "Main Left"\n    inputs: 0'),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("devices.main-left");
      expect(message).toContain("inputs");
    });

    it("rejects a destination carrying aes50", () => {
      const message = outputFailureOf(
        outputEdited(
          '    label: "Main Left"',
          '    label: "Main Left"\n    aes50: { bus: A, offset: 0 }',
        ),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("devices.main-left");
      expect(message).toContain("aes50");
    });

    it("rejects a stagebox with outputBlock but no outputs", () => {
      const message = outputFailureOf(outputEdited("    outputs: 8\n", ""));

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("devices.stagebox-1.outputs");
    });

    it("rejects a stagebox with outputs but no outputBlock", () => {
      const message = outputFailureOf(
        outputEdited("    outputBlock: { start: 9 }\n", ""),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("devices.stagebox-1.outputBlock");
    });

    it("rejects a connection with both device and consoleOutput in from", () => {
      const message = outputFailureOf(
        outputEdited(
          "  - from: { consoleOutput: 1 }",
          "  - from: { device: stagebox-1, consoleOutput: 1 }",
        ),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("connections[1].from");
    });

    it("rejects output: 0", () => {
      const message = outputFailureOf(
        outputEdited("output: 7 }", "output: 0 }"),
      );

      expect(message).toContain("Invalid installation schema");
      expect(message).toContain("connections[0].from.output");
    });
  });

  describe("semantic failures still surface from the domain layer", () => {
    it("reports overlapping output blocks with the domain's own message prefix", () => {
      const message = outputFailureOf(
        outputEdited(
          "  main-left:\n    kind: destination\n    label: \"Main Left\"",
          "  stagebox-2:\n    kind: stagebox\n    label: \"Stagebox 2\"\n    inputs: 8\n" +
            "    aes50: { bus: A, offset: 8 }\n    outputs: 8\n    outputBlock: { start: 9 }\n\n" +
            "  main-left:\n    kind: destination\n    label: \"Main Left\"",
        ),
      );

      expect(message).toContain("Invalid installation topology");
      expect(message).not.toContain("Invalid installation schema");
      expect(message).toContain("stagebox-1");
      expect(message).toContain("stagebox-2");
      expect(message).toMatch(/overlap/);
    });
  });
});
