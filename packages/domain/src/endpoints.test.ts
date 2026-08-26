import { describe, expect, it } from "vitest";

import type { EndpointRef } from "./endpoints";
import {
  aes50Channel,
  consoleOutput,
  destination,
  endpointId,
  localInput,
  mixerChannel,
  mixerOutput,
  panelInput,
  parseEndpointId,
  stageboxInput,
  stageboxOutput,
} from "./endpoints";

const CANONICAL: Array<[string, EndpointRef]> = [
  ["panel:front-left:3", panelInput("front-left", 3)],
  ["stagebox:stagebox-1:3", stageboxInput("stagebox-1", 3)],
  ["local:console:3", localInput("console", 3)],
  ["aes50:A:19", aes50Channel("A", 19)],
  ["aes50:B:48", aes50Channel("B", 48)],
  ["mixer:12", mixerChannel(12)],
  ["out:13", mixerOutput(13)],
  ["console-out:1", consoleOutput(1)],
  ["stagebox-out:stagebox-1:5", stageboxOutput("stagebox-1", 5)],
  ["dest:main-left", destination("main-left")],
];

describe("endpoint constructors", () => {
  it("validates socket numbers", () => {
    expect(() => panelInput("front-left", 0)).toThrow(/positive integer/);
    expect(() => stageboxInput("stagebox-1", -1)).toThrow(/positive integer/);
    expect(() => panelInput("front-left", 2.5)).toThrow(/positive integer/);
  });

  it("rejects out-of-range/non-integer local inputs", () => {
    expect(() => localInput("console", 0)).toThrow(/positive integer/);
    expect(() => localInput("console", -1)).toThrow(/positive integer/);
    expect(() => localInput("console", 2.5)).toThrow(/positive integer/);
  });

  it("validates AES50 bus and channel range", () => {
    expect(() => aes50Channel("C", 1)).toThrow(/Invalid AES50 bus/);
    expect(() => aes50Channel("A", 0)).toThrow(/Invalid AES50 channel/);
    expect(() => aes50Channel("A", 49)).toThrow(/Invalid AES50 channel/);
  });

  it("validates mixer channel range", () => {
    expect(() => mixerChannel(33)).toThrow(/Invalid mixer channel/);
  });

  it("validates the device id", () => {
    expect(() => panelInput("Front Left", 1)).toThrow(/Invalid device id/);
  });

  it("validates mixer-output and console-output range", () => {
    expect(() => mixerOutput(0)).toThrow(/Invalid mixer-output number/);
    expect(() => mixerOutput(17)).toThrow(/Invalid mixer-output number/);
    expect(() => consoleOutput(0)).toThrow(/Invalid console-output number/);
    expect(() => consoleOutput(17)).toThrow(/Invalid console-output number/);
  });

  it("validates stagebox-output socket numbers", () => {
    expect(() => stageboxOutput("stagebox-1", 0)).toThrow(/positive integer/);
    expect(() => stageboxOutput("stagebox-1", -1)).toThrow(/positive integer/);
  });
});

describe("endpointId", () => {
  it.each(CANONICAL)("encodes %s", (id, ref) => {
    expect(endpointId(ref)).toBe(id);
  });

  it("rejects a structurally invalid ref", () => {
    expect(() =>
      endpointId({ kind: "aes50-channel", bus: "A", channel: 60 }),
    ).toThrow(/Invalid AES50 channel/);
  });
});

describe("parseEndpointId", () => {
  it.each(CANONICAL)("round-trips %s", (id, ref) => {
    const parsed = parseEndpointId(id);
    expect(parsed).toEqual(ref);
    expect(endpointId(parsed)).toBe(id);
  });

  it.each([
    "",
    "panel",
    "panel:front-left",
    "panel:front-left:3:extra",
    "panel::3",
    "panel:front-left:x",
    "panel:front-left:0",
    "panel:front-left:-1",
    "panel:front-left:1.5",
    "stagebox:stagebox-1",
    "local:console",
    "local:console:0",
    "local:console:03",
    "local::3",
    "local:console:3:extra",
    "aes50:C:1",
    "aes50:A:49",
    "aes50:A",
    "mixer:33",
    "mixer:0",
    // Non-canonical numerics: endpointId never emits these, so parsing them
    // would give one endpoint two distinct EndpointId map keys.
    "mixer:012",
    "panel:front-left:03",
    "panel:front-left:99999999999999999999",
    "mixer:12:3",
    "socket:front-left:3",
    "PANEL:front-left:3",
    "out",
    "out:0",
    "out:17",
    "out:013",
    "out:13:extra",
    "console-out",
    "console-out:0",
    "console-out:17",
    "console-out:01",
    "stagebox-out",
    "stagebox-out:stagebox-1",
    "stagebox-out:stagebox-1:0",
    "stagebox-out:stagebox-1:05",
    "stagebox-out:stagebox-1:5:extra",
    "dest",
    "dest:main-left:extra",
  ])("rejects %o", (value) => {
    expect(() => parseEndpointId(value)).toThrow();
  });
});
