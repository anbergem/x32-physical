/**
 * The shared example installation (issue #24), traced through the domain.
 *
 * These assertions used to run against `config/installation.yaml` in
 * `packages/installation/src/node.test.ts` — same behaviour, different data:
 * cascade arithmetic, an offset panel's renumbering, a broken socket reaching
 * nothing, output-block derivation, and a block presented wholesale. Moving
 * them here is what lets the shipped venue file be edited, replaced or
 * removed without the suite going red.
 *
 * This file also guards the fixture itself: if someone extends it, these
 * tests say what the other packages rely on it still exercising.
 */

import { describe, expect, it } from "vitest";

import { exampleInstallation } from "./__fixtures__/example-installation";
import {
  aes50Channel,
  consoleOutput,
  destination,
  endpointId,
  panelInput,
  stageboxOutput,
} from "./endpoints";
import { buildOutputRouteIndex } from "./output-routing";
import {
  aes50ChannelsByEndpoint,
  deriveStaticEdges,
} from "./topology";
import { validateInstallation } from "./validation";

describe("the example installation", () => {
  it("is a valid installation", () => {
    expect(validateInstallation(exampleInstallation())).toEqual([]);
  });

  it("declares a cascade of two 16-in stageboxes on one bus", () => {
    expect(
      exampleInstallation()
        .devices.filter((device) => device.kind === "stagebox")
        .map((device) => ({
          id: device.id,
          inputs: device.inputs,
          aes50: device.aes50,
        })),
    ).toEqual([
      { id: "snake-a", inputs: 16, aes50: { bus: "A", offset: 0 } },
      { id: "snake-b", inputs: 16, aes50: { bus: "A", offset: 16 } },
    ]);
  });

  it("declares the offset panel with 6 inputs, socket 1 annotated broken", () => {
    const panel = exampleInstallation().devices.find(
      (device) => device.id === "usr-box",
    );

    expect(panel?.inputs).toBe(6);
    expect(panel?.sockets).toEqual([
      { input: 1, status: "broken", note: "Damaged - not in use" },
    ]);
  });

  it("resolves the offset panel's renumbering: socket 3 -> A18, socket 6 -> A21", () => {
    const map = aes50ChannelsByEndpoint(exampleInstallation());

    expect(map.get(endpointId(panelInput("usr-box", 3)))).toEqual(
      aes50Channel("A", 18),
    );
    expect(map.get(endpointId(panelInput("usr-box", 6)))).toEqual(
      aes50Channel("A", 21),
    );
  });

  it("maps the 1:1 panel straight through its stagebox", () => {
    const map = aes50ChannelsByEndpoint(exampleInstallation());

    expect(map.get(endpointId(panelInput("dsl-plate", 1)))).toEqual(
      aes50Channel("A", 1),
    );
    expect(map.get(endpointId(panelInput("dsl-plate", 8)))).toEqual(
      aes50Channel("A", 8),
    );
  });

  it("reaches no AES50 channel from the broken socket 1", () => {
    const map = aes50ChannelsByEndpoint(exampleInstallation());

    expect(map.has(endpointId(panelInput("usr-box", 1)))).toBe(false);
  });

  it("derives the cascade: snake-b input 7 is AES50-A 23", () => {
    const edges = deriveStaticEdges(exampleInstallation());

    expect(
      edges.map((edge) => ({
        from: endpointId(edge.from),
        to: endpointId(edge.to),
      })),
    ).toContainEqual({ from: "stagebox:snake-b:7", to: "aes50:A:23" });
  });
});

describe("the example installation: output side", () => {
  it("carries 5 destinations, all with inputs: 0, and both output blocks", () => {
    const installation = exampleInstallation();

    const destinations = installation.devices.filter(
      (device) => device.kind === "destination",
    );
    expect(destinations).toHaveLength(5);
    expect(destinations.every((device) => device.inputs === 0)).toBe(true);
    expect(destinations.map((device) => device.id).sort()).toEqual(
      [
        "balcony-fill",
        "foyer-feed",
        "green-room",
        "house-left",
        "house-right",
      ].sort(),
    );

    const stageboxes = installation.devices.filter(
      (device) => device.kind === "stagebox",
    );
    expect(
      stageboxes.map((device) => ({
        id: device.id,
        outputBlock: device.outputBlock,
      })),
    ).toEqual([
      { id: "snake-a", outputBlock: { start: 9 } },
      { id: "snake-b", outputBlock: { start: 1 } },
    ]);
  });

  it("cables every destination exactly once", () => {
    const outputConnections = exampleInstallation().connections.filter(
      (edge) => edge.to.kind === "destination",
    );

    expect(outputConnections).toHaveLength(5);
  });

  it("resolves Out 13 -> snake-a out 5 -> house-left", () => {
    const index = buildOutputRouteIndex(exampleInstallation(), []);

    const route = index.byMixerOutput.get(13);
    expect(route?.endpoints).toEqual([
      "out:13",
      "stagebox-out:snake-a:5",
      "dest:house-left",
    ]);
    expect(route?.destinations).toEqual([destination("house-left")]);
  });

  it("resolves Out 1 -> console-out:1 -> green-room", () => {
    const index = buildOutputRouteIndex(exampleInstallation(), []);

    const route = index.byMixerOutput.get(1);
    // Out 1 is presented both on the console XLR (declared) and wholesale on
    // Snake B's block (derived, outputBlock.start = 1) — both physical outs
    // appear alongside the destination.
    expect(route?.endpoints).toContain(endpointId(consoleOutput(1)));
    expect(route?.endpoints).toContain(
      endpointId(stageboxOutput("snake-b", 1)),
    );
    expect(route?.destinations).toEqual([destination("green-room")]);
  });
});
