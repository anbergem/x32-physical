import { describe, expect, it } from "vitest";

import { outputVenueInstallation } from "./__fixtures__/output-venue";
import { venueInstallation } from "./__fixtures__/venue";
import {
  aes50Channel,
  consoleOutput,
  destination,
  localInput,
  mixerOutput,
  panelInput,
  stageboxInput,
  stageboxOutput,
} from "./endpoints";
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

/** Applies a purposeful break to a fresh copy of the output venue topology. */
function brokenOutput(mutate: (installation: Installation) => void): Installation {
  const installation = outputVenueInstallation();
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

describe("validateInstallation: console device", () => {
  /** The venue installation plus a declared 32-input console device. */
  function withConsole(mutate?: (installation: Installation) => void): Installation {
    const installation = broken(() => {
      /* start from the unbroken venue fixture */
    });
    installation.devices.push({
      id: deviceId("console"),
      kind: "console",
      label: "Console",
      inputs: 32,
    });
    mutate?.(installation);
    return installation;
  }

  it("accepts a declared console device", () => {
    expect(validateInstallation(withConsole())).toEqual([]);
  });

  it("rejects two console devices", () => {
    const installation = withConsole((topology) => {
      topology.devices.push({
        id: deviceId("console-2"),
        kind: "console",
        label: "Console 2",
        inputs: 32,
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["multiple-console-devices"]);
    expect(errors[0]?.message).toMatch(/console.*console-2|console-2.*console/);
  });

  it("rejects a console device declaring an aes50 mapping", () => {
    const installation = withConsole((topology) => {
      const console_ = topology.devices.find((device) => device.kind === "console")!;
      // AES50-B, so the only error is the console-specific one, not an
      // incidental range overlap with the stageboxes on AES50-A.
      console_.aes50 = { bus: "B", offset: 0 };
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["unexpected-aes50"]);
  });

  it("rejects a connection to a console input out of range", () => {
    const installation = withConsole((topology) => {
      topology.connections.push({
        from: panelInput("front-left", 3),
        to: localInput("console", 40),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["input-out-of-range"]);
  });

  it("rejects two panel sockets feeding one console input", () => {
    const installation = withConsole((topology) => {
      topology.connections.push(
        { from: panelInput("front-left", 3), to: localInput("console", 5) },
        { from: panelInput("front-left", 4), to: localInput("console", 5) },
      );
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual([
      "local-input-multiple-sources",
    ]);
  });

  it("accepts a panel socket cabled to a console input", () => {
    const installation = withConsole((topology) => {
      topology.connections.push({
        from: panelInput("front-left", 3),
        to: localInput("console", 5),
      });
    });
    expect(validateInstallation(installation)).toEqual([]);
  });
});

describe("validateInstallation: output side", () => {
  it("accepts the output venue installation", () => {
    expect(validateInstallation(outputVenueInstallation())).toEqual([]);
  });

  it("rejects a destination declaring inputs/aes50/outputs/outputBlock", () => {
    const installation = brokenOutput((topology) => {
      const dest = topology.devices.find((d) => d.id === "front-venstre")!;
      dest.inputs = 1;
    });
    expect(codesOf(installation)).toEqual(["unexpected-destination-fields"]);
  });

  it("rejects an outputBlock.start outside 1-16", () => {
    const installation = brokenOutput((topology) => {
      topology.devices[0]!.outputBlock = { start: 0 };
    });
    expect(codesOf(installation)).toEqual(["invalid-output-block"]);
  });

  it("rejects an outputBlock whose 8 slots run past 16", () => {
    const installation = brokenOutput((topology) => {
      topology.devices[0]!.outputBlock = { start: 10 };
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["invalid-output-block"]);
    expect(errors[0]?.message).toMatch(/outputBlock\.start=10/);
  });

  it("accepts an outputBlock ending exactly on slot 16", () => {
    const installation = brokenOutput((topology) => {
      topology.devices[0]!.outputBlock = { start: 9 }; // 9-16
      topology.devices[1]!.outputBlock = { start: 1 }; // 1-8
    });
    expect(validateInstallation(installation)).toEqual([]);
  });

  it("rejects overlapping output blocks", () => {
    const installation = brokenOutput((topology) => {
      topology.devices[1]!.outputBlock = { start: 5 }; // collides with H's 1-8
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual(["output-block-overlap"]);
    expect(errors[0]?.message).toMatch(/stagebox-h.*stagebox-v/s);
  });

  it("rejects a connection naming an unknown device", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: stageboxOutput("ghost-box", 1),
        to: destination("front-venstre"),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toContain("unknown-device");
    expect(errors.some((error) => error.message.includes("ghost-box"))).toBe(
      true,
    );
  });

  it("rejects an endpoint whose device is of the wrong kind", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: stageboxOutput("front-venstre", 1), // a destination used as a stagebox
        to: destination("sidesal"),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toContain("device-kind-mismatch");
  });

  it("rejects an output number outside 1-16", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: mixerOutput(1),
        to: consoleOutput(1),
      });
      // Bypass the constructor's own range check to simulate a malformed
      // loaded value.
      (topology.connections[topology.connections.length - 1]!.from as {
        output: number;
      }).output = 17;
    });
    expect(codesOf(installation)).toContain("output-out-of-range");
  });

  it("rejects a stagebox-output number the device does not have", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: stageboxOutput("stagebox-h", 9), // the box has 8 outputs
        to: destination("sidesal"),
      });
    });
    expect(codesOf(installation)).toEqual(["output-out-of-range"]);
  });

  it("rejects a console Out slot declared on more than one console XLR", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: mixerOutput(1), // already declared to console-out:1
        to: consoleOutput(2),
      });
    });
    expect(codesOf(installation)).toEqual(["console-output-multiple-sources"]);
  });

  it("rejects a physical output cabled to more than one destination", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: stageboxOutput("stagebox-v", 5), // already cabled to front-venstre
        to: destination("sidesal"),
      });
    });
    expect(codesOf(installation)).toEqual([
      "physical-output-multiple-destinations",
    ]);
  });

  it("rejects connections that are not one of the four valid pairs", () => {
    const installation = brokenOutput((topology) => {
      topology.connections.push({
        from: destination("front-venstre"),
        to: mixerOutput(2),
      });
    });
    const errors = validateInstallation(installation);
    expect(errors.map((error) => error.code)).toEqual([
      "unsupported-connection",
      "unsupported-connection",
    ]);
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
