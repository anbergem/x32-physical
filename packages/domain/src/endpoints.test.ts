import { describe, expect, it } from "vitest";

import type { EndpointRef } from "./endpoints";
import {
  aes50Channel,
  endpointId,
  mixerChannel,
  panelInput,
  parseEndpointId,
  stageboxInput,
} from "./endpoints";

const CANONICAL: Array<[string, EndpointRef]> = [
  ["panel:front-left:3", panelInput("front-left", 3)],
  ["stagebox:stagebox-1:3", stageboxInput("stagebox-1", 3)],
  ["aes50:A:19", aes50Channel("A", 19)],
  ["aes50:B:48", aes50Channel("B", 48)],
  ["mixer:12", mixerChannel(12)],
];

describe("endpoint constructors", () => {
  it("validates socket numbers", () => {
    expect(() => panelInput("front-left", 0)).toThrow(/positive integer/);
    expect(() => stageboxInput("stagebox-1", -1)).toThrow(/positive integer/);
    expect(() => panelInput("front-left", 2.5)).toThrow(/positive integer/);
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
  ])("rejects %o", (value) => {
    expect(() => parseEndpointId(value)).toThrow();
  });
});
