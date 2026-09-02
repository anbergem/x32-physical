/**
 * The everyday edit builders (issue #28).
 *
 * The recurring assertion is the negative one: an interaction that asked for
 * nothing must send nothing. Tabbing through a field is the commonest thing
 * an operator does, and every needless write churns the `.bak` — the one copy
 * of the last-known-good installation.
 */

import { deviceId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import {
  addDestinationOperation,
  deviceGroupOperation,
  socketAnnotationOperation,
  uniqueDeviceId,
} from "./edits";

const PIT_BOX = deviceId("pit-box");

describe("deviceGroupOperation", () => {
  it("sends a trimmed group", () => {
    expect(deviceGroupOperation(PIT_BOX, "Old", "  New  ")).toEqual({
      kind: "set-device-group",
      device: PIT_BOX,
      group: "New",
    });
  });

  it("sends nothing when the group is unchanged", () => {
    expect(deviceGroupOperation(PIT_BOX, "Same", "Same")).toBeNull();
    expect(deviceGroupOperation(PIT_BOX, "Same", "  Same  ")).toBeNull();
  });

  it("sends a blank group, because clearing one is a real request", () => {
    // Unlike a label, being ungrouped is an ordinary state — so blank means
    // "clear it", not "no change".
    expect(deviceGroupOperation(PIT_BOX, "Old", "   ")).toEqual({
      kind: "set-device-group",
      device: PIT_BOX,
      group: "",
    });
  });

  it("sends nothing when a device with no group is left blank", () => {
    expect(deviceGroupOperation(PIT_BOX, undefined, "")).toBeNull();
  });
});

describe("socketAnnotationOperation", () => {
  it("annotates an unannotated socket", () => {
    expect(
      socketAnnotationOperation(PIT_BOX, 4, undefined, { status: "broken", note: "Bent pin" }),
    ).toEqual({
      kind: "set-socket-annotation",
      device: PIT_BOX,
      input: 4,
      status: "broken",
      note: "Bent pin",
    });
  });

  it("omits a blank note rather than writing an empty one", () => {
    const operation = socketAnnotationOperation(PIT_BOX, 4, undefined, {
      status: "unused",
      note: "   ",
    });

    expect(operation).toEqual({
      kind: "set-socket-annotation",
      device: PIT_BOX,
      input: 4,
      status: "unused",
    });
    expect(operation && "note" in operation).toBe(false);
  });

  it("sends nothing when status and note both already match", () => {
    expect(
      socketAnnotationOperation(PIT_BOX, 4, { status: "broken", note: "Bent pin" }, {
        status: "broken",
        note: "Bent pin",
      }),
    ).toBeNull();
  });

  it("sends when only the note changed", () => {
    expect(
      socketAnnotationOperation(PIT_BOX, 4, { status: "broken", note: "Old" }, {
        status: "broken",
        note: "New",
      })?.note,
    ).toBe("New");
  });

  it("clears an annotation", () => {
    expect(
      socketAnnotationOperation(PIT_BOX, 4, { status: "broken" }, { status: null }),
    ).toEqual({ kind: "set-socket-annotation", device: PIT_BOX, input: 4, status: null });
  });

  it("sends nothing when clearing a socket that has no annotation", () => {
    expect(socketAnnotationOperation(PIT_BOX, 4, undefined, { status: null })).toBeNull();
  });
});

describe("addDestinationOperation", () => {
  it("derives a readable id from the label", () => {
    expect(addDestinationOperation("Balcony Fill", "", [])).toEqual({
      kind: "add-device",
      device: deviceId("balcony-fill"),
      deviceKind: "destination",
      label: "Balcony Fill",
    });
  });

  it("includes a group when one is given", () => {
    expect(addDestinationOperation("Balcony", " Auditorium ", [])?.group).toBe("Auditorium");
  });

  it("sends nothing for a blank label", () => {
    expect(addDestinationOperation("   ", "", [])).toBeNull();
  });
});

describe("uniqueDeviceId", () => {
  it("slugifies, including accented characters", () => {
    expect(uniqueDeviceId("Venstre Bak", [])).toBe("venstre-bak");
    expect(uniqueDeviceId("Café Foyer", [])).toBe("cafe-foyer");
  });

  it("suffixes only on collision", () => {
    expect(uniqueDeviceId("Foyer", [deviceId("foyer")])).toBe("foyer-2");
    expect(uniqueDeviceId("Foyer", [deviceId("foyer"), deviceId("foyer-2")])).toBe("foyer-3");
  });

  it("falls back to a usable id when the label has nothing alphanumeric", () => {
    expect(uniqueDeviceId("!!!", [])).toBe("destination");
  });
});
