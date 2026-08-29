/**
 * What a label commit sends (issue #27). The claim worth asserting is a
 * negative one — *how many* operations leave the app — because the whole
 * reason commits happen on blur/Enter rather than per keystroke is that a
 * write storm would churn the venue's file and its single `.bak`.
 */

import { deviceId } from "@x32/domain";
import type { InstallationOperation } from "@x32/installation";
import { describe, expect, it } from "vitest";

import { commitDeviceLabel, deviceLabelOperation } from "./labelEdit";
import type { InstallationEditSender } from "./labelEdit";

const PIT_BOX = deviceId("pit-box");
const VERSION = "0123456789abcdef";

interface RecordingSender extends InstallationEditSender {
  sent: Array<{ baseVersion: string; operation: InstallationOperation }>;
}

function recordingSender(): RecordingSender {
  const sent: RecordingSender["sent"] = [];
  return {
    sent,
    applyInstallationEdit(baseVersion, operation) {
      sent.push({ baseVersion, operation });
    },
  };
}

describe("deviceLabelOperation", () => {
  it("builds one set-device-label for a changed label", () => {
    expect(deviceLabelOperation(PIT_BOX, "Pit Box", "Pit Box B")).toEqual({
      kind: "set-device-label",
      device: "pit-box",
      label: "Pit Box B",
    });
  });

  it("trims what was typed", () => {
    expect(deviceLabelOperation(PIT_BOX, "Pit Box", "  Pit Box B  ")?.label).toBe("Pit Box B");
  });

  it("sends nothing when the label did not change", () => {
    expect(deviceLabelOperation(PIT_BOX, "Pit Box", "Pit Box")).toBeNull();
  });

  it("sends nothing when only surrounding whitespace changed", () => {
    expect(deviceLabelOperation(PIT_BOX, "Pit Box", "  Pit Box ")).toBeNull();
  });

  it("treats a blanked field as no change, never as a request to erase the name", () => {
    expect(deviceLabelOperation(PIT_BOX, "Pit Box", "")).toBeNull();
    expect(deviceLabelOperation(PIT_BOX, "Pit Box", "   ")).toBeNull();
  });
});

describe("commitDeviceLabel", () => {
  it("sends exactly one operation for a changed label", () => {
    const sender = recordingSender();

    const sent = commitDeviceLabel(sender, VERSION, PIT_BOX, "Pit Box", "Pit Box B");

    expect(sent).toBe(true);
    expect(sender.sent).toEqual([
      {
        baseVersion: VERSION,
        operation: { kind: "set-device-label", device: "pit-box", label: "Pit Box B" },
      },
    ]);
  });

  it("sends nothing when the field was merely visited", () => {
    const sender = recordingSender();

    expect(commitDeviceLabel(sender, VERSION, PIT_BOX, "Pit Box", "Pit Box")).toBe(false);
    expect(sender.sent).toEqual([]);
  });

  it("sends nothing when no version is known — an edit with no precondition is never made", () => {
    const sender = recordingSender();

    expect(commitDeviceLabel(sender, null, PIT_BOX, "Pit Box", "Pit Box B")).toBe(false);
    expect(sender.sent).toEqual([]);
  });

  it("quotes back the version it was given, so a stale one is rejected rather than applied", () => {
    const sender = recordingSender();

    commitDeviceLabel(sender, "deadbeefdeadbeef", PIT_BOX, "Pit Box", "Renamed");

    expect(sender.sent[0]?.baseVersion).toBe("deadbeefdeadbeef");
  });
});
