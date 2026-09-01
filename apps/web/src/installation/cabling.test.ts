/**
 * The cabling guardrail (issue #28).
 *
 * These assert the *interface's* answers, not the validator's. The validator
 * already rejects every illegal cable; what matters here is that the operator
 * is told **before** drawing one, because "make invalid states unreachable"
 * is the reason this editor exists rather than a spreadsheet.
 */

import { deviceId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { canStartCable, cableTargetStatus, describeUncableConsequence } from "./cabling";

const FRONT_LEFT = deviceId("front-left");
const STAGEBOX_1 = deviceId("stagebox-1");
const STAGEBOX_2 = deviceId("stagebox-2");
const ZONE_A = deviceId("zone-a");

const socket = (device: ReturnType<typeof deviceId>, input: number) =>
  ({ kind: "socket", device, input }) as const;

describe("cableTargetStatus: the input side", () => {
  it("allows a panel socket into a free stagebox input", () => {
    // stagebox-2 has nothing cabled into it in the fixture.
    const status = cableTargetStatus(
      exampleRig(),
      socket(FRONT_LEFT, 1),
      socket(STAGEBOX_2, 3),
    );

    expect(status.available).toBe(true);
    expect(status.reason).toBeNull();
  });

  it("refuses a stagebox input that already has a source, naming it", () => {
    // front-left 1..8 already feed stagebox-1 1..8.
    const status = cableTargetStatus(
      exampleRig(),
      socket(FRONT_LEFT, 2),
      socket(STAGEBOX_1, 1),
    );

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("already-fed");
    // Phrased as the installation, not the schema.
    expect(status.reason).toMatch(/Stagebox 1 input 1 already has a source/);
  });

  it("refuses an annotated target socket", () => {
    const installation = exampleRig();
    installation.devices = installation.devices.map((device) =>
      device.id === STAGEBOX_2
        ? { ...device, sockets: [{ input: 4, status: "broken" as const }] }
        : device,
    );

    const status = cableTargetStatus(installation, socket(FRONT_LEFT, 1), socket(STAGEBOX_2, 4));

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("annotated");
    expect(status.reason).toMatch(/broken or unused/);
  });

  it("refuses a destination as the target of a socket", () => {
    const status = cableTargetStatus(exampleRig(), socket(FRONT_LEFT, 1), {
      kind: "destination",
      device: ZONE_A,
    });

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("wrong-kind");
  });

  it("refuses a stagebox input as the source", () => {
    const status = cableTargetStatus(
      exampleRig(),
      socket(STAGEBOX_1, 1),
      socket(STAGEBOX_2, 3),
    );

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("wrong-kind");
  });

  it("refuses a panel as the target — only a stagebox input can be fed", () => {
    const status = cableTargetStatus(exampleRig(), socket(FRONT_LEFT, 1), socket(FRONT_LEFT, 5));

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("wrong-kind");
  });

  it("refuses the socket the cable started from", () => {
    const status = cableTargetStatus(exampleRig(), socket(FRONT_LEFT, 1), socket(FRONT_LEFT, 1));

    expect(status.refusal).toBe("same-endpoint");
  });
});

describe("cableTargetStatus: the output side", () => {
  it("allows a console output into a destination", () => {
    const status = cableTargetStatus(
      exampleRig(),
      { kind: "console-output", output: 7 },
      { kind: "destination", device: ZONE_A },
    );

    expect(status.available).toBe(true);
  });

  it("allows a stagebox output into a destination", () => {
    const status = cableTargetStatus(
      exampleRig(),
      { kind: "device-output", device: STAGEBOX_2, output: 1 },
      { kind: "destination", device: ZONE_A },
    );

    expect(status.available).toBe(true);
  });

  it("refuses an output into a stagebox input", () => {
    const status = cableTargetStatus(
      exampleRig(),
      { kind: "console-output", output: 7 },
      socket(STAGEBOX_2, 3),
    );

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("wrong-kind");
  });
});

describe("canStartCable", () => {
  it("allows an unannotated panel socket", () => {
    expect(canStartCable(exampleRig(), socket(FRONT_LEFT, 1)).available).toBe(true);
  });

  it("refuses to start from a stagebox input, which receives signal", () => {
    // The domain permits panel-input → stagebox-input, never the reverse and
    // never stagebox → stagebox. Offering it would invite an edit the
    // pipeline is bound to refuse — caught in the browser, where exactly that
    // happened and the rejection was silent.
    const status = canStartCable(exampleRig(), socket(STAGEBOX_1, 1));

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("wrong-kind");
  });

  it("refuses to start from an annotated socket, so the affordance is never offered", () => {
    const installation = exampleRig();
    installation.devices = installation.devices.map((device) =>
      device.id === FRONT_LEFT
        ? { ...device, sockets: [{ input: 3, status: "unused" as const }] }
        : device,
    );

    const status = canStartCable(installation, socket(FRONT_LEFT, 3));

    expect(status.available).toBe(false);
    expect(status.refusal).toBe("annotated");
  });
});

describe("describeUncableConsequence", () => {
  it("says what the installation will no longer do, not 'connection removed'", () => {
    expect(
      describeUncableConsequence(exampleRig(), socket(FRONT_LEFT, 1), socket(STAGEBOX_1, 1)),
    ).toBe("Stagebox 1 input 1 will have no source.");
  });

  it("names the destination that loses its feed", () => {
    expect(
      describeUncableConsequence(
        exampleRig(),
        { kind: "console-output", output: 1 },
        { kind: "destination", device: ZONE_A },
      ),
    ).toBe("Zone A will have no feed.");
  });
});
