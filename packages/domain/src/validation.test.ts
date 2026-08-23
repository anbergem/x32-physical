import { describe, expect, it } from "vitest";

import { venueInstallation } from "./__fixtures__/venue";
import { aes50Channel, panelInput, stageboxInput } from "./endpoints";
import { deviceId } from "./ids";
import type { Installation } from "./topology";
import {
  assertValidInstallation,
  validateInstallation,
} from "./validation";
import type { InstallationValidationErrorCode } from "./validation";

function codesOf(installation: Installation): InstallationValidationErrorCode[] {
  return validateInstallation(installation).map((error) => error.code);
}

/** Applies a purposeful break to a fresh copy of the venue topology. */
function broken(mutate: (installation: Installation) => void): Installation {
  const installation = venueInstallation();
  mutate(installation);
  return installation;
}

describe("validateInstallation", () => {
  it("accepts the venue installation", () => {
    expect(validateInstallation(venueInstallation())).toEqual([]);
  });

  it("accepts an empty installation", () => {
    expect(validateInstallation({ devices: [], connections: [] })).toEqual([]);
  });

  it("rejects duplicate device ids", () => {
    const installation = broken((topology) => {
      topology.devices.push({
        id: deviceId("stagebox-1"),
        kind: "passive-panel",
        label: "Clone",
        inputs: 4,
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toContain("duplicate-device-id");
    expect(errors[0]?.message).toMatch(/stagebox-1/);
  });

  it("does not report a duplicated stagebox as overlapping itself", () => {
    const installation = broken((topology) => {
      topology.devices.push({
        id: deviceId("stagebox-2"),
        kind: "stagebox",
        label: "Stagebox 2 (pasted twice)",
        inputs: 16,
        aes50: { bus: "A", offset: 16 },
      });
    });
    expect(codesOf(installation)).toEqual(["duplicate-device-id"]);
  });

  it("rejects a device with no inputs", () => {
    const installation = broken((topology) => {
      topology.devices[2]!.inputs = 0;
    });
    expect(codesOf(installation)).toContain("invalid-input-count");
  });

  it("requires stageboxes to declare an AES50 mapping", () => {
    const installation = broken((topology) => {
      delete topology.devices[0]!.aes50;
    });
    expect(codesOf(installation)).toEqual(["missing-aes50"]);
  });

  it("forbids an AES50 mapping on a passive panel", () => {
    const installation = broken((topology) => {
      topology.devices[2]!.aes50 = { bus: "B", offset: 0 };
    });
    expect(codesOf(installation)).toEqual(["unexpected-aes50"]);
  });

  it("rejects a negative AES50 offset", () => {
    const installation = broken((topology) => {
      topology.devices[1]!.aes50 = { bus: "A", offset: -1 };
    });
    expect(codesOf(installation)).toEqual(["invalid-aes50-offset"]);
  });

  it("rejects an AES50 range running past channel 48", () => {
    const installation = broken((topology) => {
      topology.devices[1]!.aes50 = { bus: "A", offset: 40 };
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual([
      "aes50-range-out-of-bounds",
    ]);
    expect(errors[0]?.message).toMatch(/41–56/);
  });

  it("accepts an AES50 range ending exactly on channel 48", () => {
    const installation = broken((topology) => {
      topology.devices[1]!.aes50 = { bus: "A", offset: 32 }; // A33–48
    });
    expect(validateInstallation(installation)).toEqual([]);
  });

  it("rejects a one-channel AES50 overlap", () => {
    const installation = broken((topology) => {
      // stagebox-1 holds A1–16; A16–31 collides on exactly one channel.
      topology.devices[1]!.aes50 = { bus: "A", offset: 15 };
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["aes50-range-overlap"]);
    expect(errors[0]?.message).toMatch(/16–31/);
  });

  it("rejects overlapping AES50 ranges on the same bus", () => {
    const installation = broken((topology) => {
      topology.devices[1]!.aes50 = { bus: "A", offset: 8 };
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["aes50-range-overlap"]);
    expect(errors[0]?.message).toMatch(/stagebox-1.*stagebox-2/s);
  });

  it("allows identical offsets on different buses", () => {
    const installation = broken((topology) => {
      topology.devices[1]!.aes50 = { bus: "B", offset: 0 };
    });
    expect(validateInstallation(installation)).toEqual([]);
  });

  it("rejects a connection naming an unknown device", () => {
    const installation = broken((topology) => {
      topology.connections.push({
        from: panelInput("ghost-panel", 1),
        to: stageboxInput("stagebox-1", 5),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["unknown-device"]);
    expect(errors[0]?.connectionIndex).toBe(3);
    expect(errors[0]?.message).toMatch(/ghost-panel/);
  });

  it("rejects a connection using an input the device does not have", () => {
    const installation = broken((topology) => {
      topology.connections.push({
        from: panelInput("front-left", 9), // the panel has 8 sockets
        to: stageboxInput("stagebox-1", 17), // the box has 16 inputs
      });
    });
    expect(codesOf(installation)).toEqual([
      "input-out-of-range",
      "input-out-of-range",
    ]);
  });

  it("rejects connections that are not panel-input → stagebox-input", () => {
    const installation = broken((topology) => {
      topology.connections.push({
        from: stageboxInput("stagebox-1", 3),
        to: aes50Channel("A", 3),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual([
      "unsupported-connection",
      "unsupported-connection",
    ]);
    expect(errors[0]?.message).toMatch(/panel-input → stagebox-input/);
  });

  it("rejects an endpoint whose device is of the wrong kind", () => {
    const installation = broken((topology) => {
      topology.connections.push({
        from: panelInput("stagebox-1", 3), // a stagebox used as a panel
        to: stageboxInput("stagebox-2", 3),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["device-kind-mismatch"]);
    expect(errors[0]?.message).toMatch(/declared as a stagebox/);
  });

  it("rejects two panel sockets feeding one stagebox input", () => {
    const installation = broken((topology) => {
      topology.connections.push({
        from: panelInput("front-left", 3),
        to: stageboxInput("stagebox-1", 1), // already fed by front-left 1
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual([
      "stagebox-input-multiple-sources",
    ]);
    expect(errors[0]?.message).toMatch(/front-left input 1.*front-left input 3/);
  });

  it("allows a stagebox input with no panel socket at all", () => {
    const installation = broken((topology) => {
      topology.connections = [];
    });
    expect(validateInstallation(installation)).toEqual([]);
  });

  it("reports every problem at once", () => {
    const installation = broken((topology) => {
      delete topology.devices[0]!.aes50;
      topology.devices[2]!.inputs = 0;
      topology.connections.push({
        from: panelInput("ghost-panel", 1),
        to: stageboxInput("stagebox-2", 2),
      });
    });
    expect(codesOf(installation).sort()).toEqual(
      [
        "input-out-of-range",
        "input-out-of-range",
        "input-out-of-range",
        "invalid-input-count",
        "missing-aes50",
        "unknown-device",
      ].sort(),
    );
  });
});

describe("assertValidInstallation", () => {
  it("passes a valid installation", () => {
    expect(() => assertValidInstallation(venueInstallation())).not.toThrow();
  });

  it("throws with every message joined", () => {
    const installation = broken((topology) => {
      delete topology.devices[0]!.aes50;
      topology.devices[2]!.aes50 = { bus: "B", offset: 0 };
    });
    expect(() => assertValidInstallation(installation)).toThrow(
      /Invalid installation \(2 problems\)/,
    );
    expect(() => assertValidInstallation(installation)).toThrow(
      /missing its aes50 mapping/,
    );
    expect(() => assertValidInstallation(installation)).toThrow(
      /only stageboxes connect to an AES50 bus/,
    );
  });
});
