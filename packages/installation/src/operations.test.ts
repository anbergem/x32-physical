/**
 * Operations against a `yaml` `Document` (issue #27).
 *
 * The comment-preservation test deliberately runs against
 * `config/installation.sample.yaml` — a real, shipped, heavily-commented file
 * with structure — rather than a fixture invented here. A toy document can
 * pass this while a file with anchors, nested maps, blank-line grouping and
 * trailing comments fails, and comment preservation is the entire reason
 * operations exist.
 */

import { deviceId } from "@x32/domain";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import { applyOperation, describeOperation, parseInstallationOperation } from "./operations";
import { parseInstallationYaml } from "./parse";

const SAMPLE_PATH = fileURLToPath(
  new URL("../../../config/installation.sample.yaml", import.meta.url),
);

const SAMPLE_YAML = readFileSync(SAMPLE_PATH, "utf8");

/**
 * Every whole-line comment in a document, in order. Compared as a list rather
 * than only counted, so a preserved *count* with mangled text still fails.
 */
function commentLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#"));
}

describe("applyOperation: set-device-label", () => {
  it("changes exactly the named device's label", () => {
    const document = parseDocument(SAMPLE_YAML);

    applyOperation(document, {
      kind: "set-device-label",
      device: deviceId("pit-box"),
      label: "Pit Box (renamed)",
    });

    const before = parseInstallationYaml(SAMPLE_YAML);
    const after = parseInstallationYaml(String(document));

    const labelsOf = (installation: ReturnType<typeof parseInstallationYaml>) =>
      new Map(installation.devices.map((device) => [device.id, device.label]));

    expect(labelsOf(after).get(deviceId("pit-box"))).toBe("Pit Box (renamed)");

    // Nothing else moved: same devices, same labels, same connections.
    for (const [id, label] of labelsOf(before)) {
      if (id === deviceId("pit-box")) continue;
      expect(labelsOf(after).get(id)).toBe(label);
    }
    expect(after.connections).toEqual(before.connections);
  });

  it("preserves every comment in the sample installation", () => {
    const commentsBefore = commentLines(SAMPLE_YAML);
    // Guards against the assertion passing vacuously if the sample is ever
    // stripped of its commentary.
    expect(commentsBefore.length).toBeGreaterThan(10);

    const document = parseDocument(SAMPLE_YAML);
    applyOperation(document, {
      kind: "set-device-label",
      device: deviceId("upstage-tie"),
      label: "Upstage Tie Lines",
    });

    const after = String(document);

    expect(commentLines(after)).toEqual(commentsBefore);
    expect(after).toContain("Upstage Tie Lines");
  });

  it("keeps the author's quoting style rather than reserialising the node", () => {
    const document = parseDocument(SAMPLE_YAML);
    applyOperation(document, {
      kind: "set-device-label",
      device: deviceId("house-left"),
      label: "House L",
    });

    // The sample writes labels double-quoted; an edit must not silently
    // restyle the file around the value it changed.
    expect(String(document)).toContain('label: "House L"');
  });

  it("rejects a device the document does not declare, naming it", () => {
    const document = parseDocument(SAMPLE_YAML);

    expect(() =>
      applyOperation(document, {
        kind: "set-device-label",
        device: deviceId("ghost-box"),
        label: "Nowhere",
      }),
    ).toThrow(/ghost-box/);
  });

  it("leaves the document untouched when it rejects", () => {
    const document = parseDocument(SAMPLE_YAML);

    expect(() =>
      applyOperation(document, {
        kind: "set-device-label",
        device: deviceId("ghost-box"),
        label: "Nowhere",
      }),
    ).toThrow();

    expect(String(document)).toBe(SAMPLE_YAML);
  });
});

describe("describeOperation", () => {
  it("names the device and the new label", () => {
    expect(
      describeOperation({
        kind: "set-device-label",
        device: deviceId("pit-box"),
        label: "Pit Box",
      }),
    ).toBe('set-device-label pit-box -> "Pit Box"');
  });
});

describe("parseInstallationOperation", () => {
  it("accepts a well-formed set-device-label", () => {
    expect(
      parseInstallationOperation(
        { kind: "set-device-label", device: "pit-box", label: "Pit Box" },
        "operation",
      ),
    ).toEqual({ kind: "set-device-label", device: "pit-box", label: "Pit Box" });
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      parseInstallationOperation({ kind: "delete-everything" }, "operation"),
    ).toThrow(/operation\.kind/);
  });

  it("rejects a non-object", () => {
    expect(() => parseInstallationOperation("set-device-label", "operation")).toThrow(
      /operation/,
    );
  });

  it("rejects a missing label", () => {
    expect(() =>
      parseInstallationOperation({ kind: "set-device-label", device: "pit-box" }, "operation"),
    ).toThrow(/operation\.label/);
  });

  it("rejects a device id that is not kebab-case, before it can reach setIn", () => {
    expect(() =>
      parseInstallationOperation(
        { kind: "set-device-label", device: "Pit Box", label: "x" },
        "operation",
      ),
    ).toThrow(/operation\.device/);
  });
});
