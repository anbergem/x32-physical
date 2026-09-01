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

/**
 * The everyday operations (issue #28).
 *
 * Every case runs against the shipped sample document for the reason stated
 * at the top of this file, and every one asserts comment preservation —
 * including the removals, which are where a naive implementation quietly eats
 * a comment that still applies to what is left.
 */

const PIT_BOX = deviceId("pit-box");
const PIT_WALL = deviceId("pit-wall");
const GREEN_ROOM = deviceId("green-room");
const HOUSE_LEFT = deviceId("house-left");

function sample() {
  return parseDocument(SAMPLE_YAML);
}

describe("applyOperation: set-device-group", () => {
  it("sets a group", () => {
    const document = sample();
    applyOperation(document, {
      kind: "set-device-group",
      device: PIT_BOX,
      group: "Downstage",
    });

    expect(parseInstallationYaml(String(document)).devices
      .find((d) => d.id === PIT_BOX)?.group).toBe("Downstage");
  });

  it("clears the group entirely rather than writing an empty string", () => {
    // docs/installation.md: being ungrouped is an ordinary state, so the key
    // must be absent — `group: ""` would read as a group named "".
    const document = sample();
    applyOperation(document, { kind: "set-device-group", device: PIT_BOX, group: "  " });

    const text = String(document);
    expect(text).not.toMatch(/group:\s*["']{2}/);
    expect(parseInstallationYaml(text).devices
      .find((d) => d.id === PIT_BOX)?.group).toBeUndefined();
  });

  it("trims and preserves every comment", () => {
    const document = sample();
    const before = commentLines(SAMPLE_YAML);
    applyOperation(document, {
      kind: "set-device-group",
      device: PIT_BOX,
      group: "  Downstage  ",
    });

    const text = String(document);
    expect(commentLines(text)).toEqual(before);
    expect(parseInstallationYaml(text).devices
      .find((d) => d.id === PIT_BOX)?.group).toBe("Downstage");
  });

  it("rejects an unknown device by name", () => {
    expect(() =>
      applyOperation(sample(), {
        kind: "set-device-group",
        device: deviceId("no-such-device"),
        group: "X",
      }),
    ).toThrow(/no-such-device/);
  });
});

describe("applyOperation: set-socket-annotation", () => {
  it("annotates an uncabled socket with a note", () => {
    const document = sample();
    applyOperation(document, {
      kind: "set-socket-annotation",
      device: PIT_WALL,
      input: 4,
      status: "unused",
      note: "Spare",
    });

    const socket = parseInstallationYaml(String(document)).devices
      .find((d) => d.id === PIT_WALL)?.sockets?.find((s) => s.input === 4);
    expect(socket?.status).toBe("unused");
    expect(socket?.note).toBe("Spare");
  });

  it("creates the sockets map on a device that has none", () => {
    // Regression: `setIn` infers its container from the next path token, so a
    // numeric key on an absent `sockets` built a YAML *array*, which the
    // schema rejects as "expected record, received array". Only a device with
    // no existing annotations exercises this — pit-box has none.
    const document = sample();
    applyOperation(document, {
      kind: "set-socket-annotation",
      device: PIT_BOX,
      input: 7,
      status: "unused",
      note: "Spare",
    });

    // Parsed, so a wrong container shape fails here rather than merely
    // looking odd in the text.
    const socket = parseInstallationYaml(String(document)).devices
      .find((d) => d.id === PIT_BOX)?.sockets?.find((s) => s.input === 7);
    expect(socket?.status).toBe("unused");
    expect(socket?.note).toBe("Spare");
  });

  it("clears an annotation, and drops the sockets key with the last one", () => {
    const document = sample();
    applyOperation(document, {
      kind: "set-socket-annotation",
      device: PIT_WALL,
      input: 4,
      status: null,
    });

    const text = String(document);
    const device = parseInstallationYaml(text).devices.find((d) => d.id === PIT_WALL);
    expect(device?.sockets ?? []).toEqual([]);
    // The empty `sockets:` map is noise the author never wrote.
    expect(text).not.toMatch(/sockets:\s*\{\s*\}/);
  });

  it("removes an existing note when none is given", () => {
    // The sample's pit-wall socket 4 carries "Cracked connector — do not use".
    const document = sample();
    applyOperation(document, {
      kind: "set-socket-annotation",
      device: PIT_WALL,
      input: 4,
      status: "broken",
    });

    const socket = parseInstallationYaml(String(document)).devices
      .find((d) => d.id === PIT_WALL)?.sockets?.find((s) => s.input === 4);
    expect(socket?.status).toBe("broken");
    expect(socket?.note).toBeUndefined();
  });

  it("preserves every comment", () => {
    const document = sample();
    applyOperation(document, {
      kind: "set-socket-annotation",
      device: PIT_WALL,
      input: 4,
      status: "broken",
      note: "Bent pin",
    });

    expect(commentLines(String(document))).toEqual(commentLines(SAMPLE_YAML));
  });
});

describe("applyOperation: add-connection / remove-connection", () => {
  it("cables a socket to a stagebox input", () => {
    // Every panel socket in the sample is either cabled or annotated, so
    // freeing one first is also the realistic sequence: a technician repairs
    // the dead socket, clears the annotation, then patches it.
    const document = sample();
    applyOperation(document, {
      kind: "set-socket-annotation",
      device: PIT_WALL,
      input: 4,
      status: null,
    });
    applyOperation(document, {
      kind: "add-connection",
      from: { kind: "socket", device: PIT_WALL, input: 4 },
      to: { kind: "socket", device: PIT_BOX, input: 7 },
    });

    const text = String(document);
    // Asserted through the parser, not the rendered text: how `yaml` chooses
    // to format a newly created node is not this operation's contract.
    const installation = parseInstallationYaml(text);
    expect(
      installation.connections.some(
        (c) => JSON.stringify(c.from).includes('"pit-wall"') && JSON.stringify(c.from).includes("4"),
      ),
    ).toBe(true);
    expect(commentLines(text)).toEqual(commentLines(SAMPLE_YAML));
  });

  it("cables a console output to a destination", () => {
    const document = sample();
    applyOperation(document, {
      kind: "add-connection",
      from: { kind: "console-output", output: 7 },
      to: { kind: "destination", device: GREEN_ROOM },
    });

    // Parsed, so this asserts a *valid* installation, not just text.
    const installation = parseInstallationYaml(String(document));
    expect(
      installation.connections.some((c) => JSON.stringify(c).includes("green-room")),
    ).toBe(true);
  });

  it("refuses to add a cable that already exists", () => {
    expect(() =>
      applyOperation(sample(), {
        kind: "add-connection",
        from: { kind: "socket", device: PIT_WALL, input: 1 },
        to: { kind: "socket", device: PIT_BOX, input: 1 },
      }),
    ).toThrow(/already cabled/);
  });

  it("refuses to cable a device that does not exist", () => {
    expect(() =>
      applyOperation(sample(), {
        kind: "add-connection",
        from: { kind: "socket", device: deviceId("ghost"), input: 1 },
        to: { kind: "socket", device: PIT_BOX, input: 9 },
      }),
    ).toThrow(/ghost/);
  });

  it("removes an existing cable", () => {
    const document = sample();
    applyOperation(document, {
      kind: "remove-connection",
      from: { kind: "socket", device: PIT_WALL, input: 1 },
      to: { kind: "socket", device: PIT_BOX, input: 1 },
    });

    const installation = parseInstallationYaml(String(document));
    expect(installation.connections).not.toContainEqual(
      expect.objectContaining({ from: expect.objectContaining({ device: PIT_WALL, input: 1 }) }),
    );
  });

  it("carries a block comment onto the next cable rather than deleting it", () => {
    // The comment above the first pit-wall cable describes the whole block.
    // Removing that cable must not take a comment that still applies.
    const document = sample();
    applyOperation(document, {
      kind: "remove-connection",
      from: { kind: "socket", device: PIT_WALL, input: 1 },
      to: { kind: "socket", device: PIT_BOX, input: 1 },
    });

    expect(commentLines(String(document))).toEqual(commentLines(SAMPLE_YAML));
  });

  it("refuses to remove a cable that is not there", () => {
    expect(() =>
      applyOperation(sample(), {
        kind: "remove-connection",
        from: { kind: "socket", device: PIT_WALL, input: 2 },
        to: { kind: "socket", device: PIT_BOX, input: 9 },
      }),
    ).toThrow(/not cabled/);
  });
});

describe("applyOperation: add-destination", () => {
  it("adds a destination with a group", () => {
    const document = sample();
    applyOperation(document, {
      kind: "add-destination",
      device: deviceId("balcony"),
      label: "Balcony Fill",
      group: "Auditorium",
    });

    const device = parseInstallationYaml(String(document)).devices
      .find((d) => d.id === deviceId("balcony"));
    expect(device?.kind).toBe("destination");
    expect(device?.label).toBe("Balcony Fill");
    expect(device?.group).toBe("Auditorium");
    // The loader supplies 0; it is never authored.
    expect(device?.inputs).toBe(0);
  });

  it("omits the group key when none is given", () => {
    const document = sample();
    applyOperation(document, {
      kind: "add-destination",
      device: deviceId("balcony"),
      label: "Balcony Fill",
    });

    expect(parseInstallationYaml(String(document)).devices
      .find((d) => d.id === deviceId("balcony"))?.group).toBeUndefined();
  });

  it("refuses a duplicate device id", () => {
    expect(() =>
      applyOperation(sample(), {
        kind: "add-destination",
        device: GREEN_ROOM,
        label: "Another Green Room",
      }),
    ).toThrow(/already exists/);
  });

  it("preserves every comment", () => {
    const document = sample();
    applyOperation(document, {
      kind: "add-destination",
      device: deviceId("balcony"),
      label: "Balcony Fill",
    });

    expect(commentLines(String(document))).toEqual(commentLines(SAMPLE_YAML));
  });
});

describe("applyOperation: remove-device", () => {
  it("removes a destination and its connections atomically, leaving a valid document", () => {
    const document = sample();
    applyOperation(document, { kind: "remove-device", device: HOUSE_LEFT });

    // Validity is the point: a device removed without its cables would leave
    // a dangling reference, and this parse would throw.
    const result = parseInstallationYaml(String(document));
    expect(result.devices.some((d) => d.id === HOUSE_LEFT)).toBe(false);
    expect(
      result.connections.some((c) => JSON.stringify(c).includes("house-left")),
    ).toBe(false);
  });

  it("refuses to remove anything that is not a destination", () => {
    // Removing a stagebox changes cascade arithmetic across the whole file —
    // structural editing, issue #29.
    expect(() =>
      applyOperation(sample(), { kind: "remove-device", device: PIT_BOX }),
    ).toThrow(/only destinations/);
  });

  it("refuses an unknown device", () => {
    expect(() =>
      applyOperation(sample(), { kind: "remove-device", device: deviceId("ghost") }),
    ).toThrow(/ghost/);
  });
});

describe("parseInstallationOperation: the everyday operations", () => {
  it("accepts each new kind", () => {
    expect(parseInstallationOperation(
      { kind: "set-device-group", device: "pit-box", group: "X" }, "op",
    ).kind).toBe("set-device-group");

    expect(parseInstallationOperation(
      { kind: "set-socket-annotation", device: "pit-box", input: 4, status: null }, "op",
    ).kind).toBe("set-socket-annotation");

    expect(parseInstallationOperation({
      kind: "add-connection",
      from: { kind: "socket", device: "pit-wall", input: 4 },
      to: { kind: "socket", device: "pit-box", input: 7 },
    }, "op").kind).toBe("add-connection");

    expect(parseInstallationOperation(
      { kind: "add-destination", device: "balcony", label: "Balcony" }, "op",
    ).kind).toBe("add-destination");

    expect(parseInstallationOperation(
      { kind: "remove-device", device: "green-room" }, "op",
    ).kind).toBe("remove-device");
  });

  it("rejects a bad annotation status and a bad socket number", () => {
    expect(() => parseInstallationOperation(
      { kind: "set-socket-annotation", device: "pit-box", input: 4, status: "melted" }, "op",
    )).toThrow(/status/);

    expect(() => parseInstallationOperation(
      { kind: "set-socket-annotation", device: "pit-box", input: 0, status: "broken" }, "op",
    )).toThrow(/input/);
  });

  it("rejects a structurally ambiguous connection end", () => {
    expect(() => parseInstallationOperation({
      kind: "add-connection",
      from: { device: "pit-wall", input: 4 },
      to: { kind: "socket", device: "pit-box", input: 7 },
    }, "op")).toThrow(/from/);
  });
});
