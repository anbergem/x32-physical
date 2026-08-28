import { describe, expect, it } from "vitest";

import { exampleInstallation } from "./__fixtures__/example-installation";
import { outputVenueInstallation } from "./__fixtures__/output-venue";
import { venueInstallation } from "./__fixtures__/venue";
import type { EndpointRef } from "./endpoints";
import {
  aes50Channel,
  endpointId,
  mixerOutput,
  panelInput,
  stageboxInput,
  stageboxOutput,
} from "./endpoints";
import { deviceId } from "./ids";
import {
  aes50ChannelForInput,
  aes50ChannelsByEndpoint,
  deriveOutputEdges,
  deriveStaticEdges,
} from "./topology";
import type { Device, Installation, TopologyEdge } from "./topology";

function edgeFrom(edges: TopologyEdge[], from: EndpointRef): TopologyEdge {
  const id = endpointId(from);
  const match = edges.filter((edge) => endpointId(edge.from) === id);
  expect(match).toHaveLength(1);
  return match[0] as TopologyEdge;
}

describe("deriveStaticEdges", () => {
  const installation = venueInstallation();
  const edges = deriveStaticEdges(installation);

  it("keeps every explicitly cabled connection", () => {
    for (const connection of installation.connections) {
      expect(edges).toContainEqual(connection);
    }
  });

  it("derives one AES50 edge per stagebox input and nothing else", () => {
    // 3 declared panel→stagebox connections + 16 + 16 derived edges.
    expect(edges).toHaveLength(35);
  });

  it("maps stagebox-1 (offset 0) onto AES50-A 1–16", () => {
    expect(edgeFrom(edges, stageboxInput("stagebox-1", 1)).to).toEqual(
      aes50Channel("A", 1),
    );
    expect(edgeFrom(edges, stageboxInput("stagebox-1", 16)).to).toEqual(
      aes50Channel("A", 16),
    );
  });

  it("maps cascaded stagebox-2 (offset 16) onto AES50-A 17–32", () => {
    expect(edgeFrom(edges, stageboxInput("stagebox-2", 1)).to).toEqual(
      aes50Channel("A", 17),
    );
    // The documented cascade example: Box 2 / 7 is AES50-A 23.
    expect(endpointId(edgeFrom(edges, stageboxInput("stagebox-2", 7)).to)).toBe(
      "aes50:A:23",
    );
    expect(edgeFrom(edges, stageboxInput("stagebox-2", 16)).to).toEqual(
      aes50Channel("A", 32),
    );
  });

  it("derives no AES50 edges for passive panels", () => {
    const fromPanels = edges.filter(
      (edge) => edge.from.kind === "panel-input" && edge.to.kind !== "stagebox-input",
    );
    expect(fromPanels).toEqual([]);
  });

  it("leaves unused stagebox inputs as valid direct stage sockets", () => {
    // stagebox-1 input 5 has no panel feeding it but still reaches the bus.
    expect(edgeFrom(edges, stageboxInput("stagebox-1", 5)).to).toEqual(
      aes50Channel("A", 5),
    );
  });

  it("honours a stagebox on AES50-B", () => {
    const installationB: Installation = {
      devices: [
        {
          id: deviceId("stagebox-1"),
          kind: "stagebox",
          label: "Stagebox 1",
          inputs: 8,
          aes50: { bus: "B", offset: 40 },
        },
      ],
      connections: [],
    };
    const derived = deriveStaticEdges(installationB);
    expect(derived).toHaveLength(8);
    expect(endpointId(derived[7]!.to)).toBe("aes50:B:48");
  });
});

describe("aes50ChannelForInput", () => {
  const installation = venueInstallation();

  function device(id: string): Device {
    const match = installation.devices.find(
      (candidate) => candidate.id === deviceId(id),
    );
    expect(match).toBeDefined();
    return match as Device;
  }

  it("maps the first box's inputs one-to-one onto the bus", () => {
    expect(aes50ChannelForInput(device("stagebox-1"), 1)).toEqual(
      aes50Channel("A", 1),
    );
    expect(aes50ChannelForInput(device("stagebox-1"), 16)).toEqual(
      aes50Channel("A", 16),
    );
  });

  it("shifts a cascaded box by its offset", () => {
    const cascaded = device("stagebox-2"); // offset 16
    expect(aes50ChannelForInput(cascaded, 1)).toEqual(aes50Channel("A", 17));
    // The dual label the UI prints on stagebox-2 socket 7.
    expect(aes50ChannelForInput(cascaded, 7)).toEqual(aes50Channel("A", 23));
    expect(aes50ChannelForInput(cascaded, 16)).toEqual(aes50Channel("A", 32));
  });

  it("returns nothing for a device with no AES50 mapping", () => {
    expect(aes50ChannelForInput(device("front-left"), 1)).toBeUndefined();
  });

  it("rejects a mapping that runs off the end of the bus", () => {
    const overflowing: Device = {
      id: deviceId("stagebox-3"),
      kind: "stagebox",
      label: "Stagebox 3",
      inputs: 16,
      aes50: { bus: "A", offset: 40 },
    };
    expect(() => aes50ChannelForInput(overflowing, 9)).toThrow(/AES50 channel/);
  });
});

/**
 * Driven by the shared example fixture (issue #24) rather than a hand-copied
 * mirror of `config/installation.yaml`: it carries the shapes this function
 * exists to get right — a 1:1 panel, a panel cabled with an offset, a broken
 * socket cabled to nothing, and a cascaded box.
 */
describe("aes50ChannelsByEndpoint", () => {
  const installation = exampleInstallation();
  const map = aes50ChannelsByEndpoint(installation);

  it("maps the 1:1 panel straight through its stagebox", () => {
    expect(map.get(endpointId(panelInput("dsl-plate", 1)))).toEqual(
      aes50Channel("A", 1),
    );
    expect(map.get(endpointId(panelInput("dsl-plate", 8)))).toEqual(
      aes50Channel("A", 8),
    );
  });

  it("maps the offset panel by physical position, dead socket 1 excluded", () => {
    // usr-box socket n -> snake-b input n - 1, on the cascaded box: socket 3
    // -> input 2 -> A18, through socket 6 -> input 5 -> A21.
    expect(map.get(endpointId(panelInput("usr-box", 3)))).toEqual(
      aes50Channel("A", 18),
    );
    expect(map.get(endpointId(panelInput("usr-box", 6)))).toEqual(
      aes50Channel("A", 21),
    );
    // Socket 1 is broken and uncabled: it reaches no AES50 channel.
    expect(map.has(endpointId(panelInput("usr-box", 1)))).toBe(false);
  });

  it("maps direct stage sockets (uncabled stagebox inputs) too", () => {
    expect(map.get(endpointId(stageboxInput("snake-b", 6)))).toEqual(
      aes50Channel("A", 22),
    );
    expect(map.get(endpointId(stageboxInput("snake-b", 7)))).toEqual(
      aes50Channel("A", 23),
    );
    expect(map.get(endpointId(stageboxInput("snake-a", 16)))).toEqual(
      aes50Channel("A", 16),
    );
  });

  it("omits a panel socket cabled to nothing", () => {
    const withUncabledSocket: Installation = {
      devices: [
        {
          id: deviceId("front-left"),
          kind: "passive-panel",
          label: "Front Left",
          inputs: 2,
        },
        {
          id: deviceId("stagebox-1"),
          kind: "stagebox",
          label: "Stagebox 1",
          inputs: 4,
          aes50: { bus: "A", offset: 0 },
        },
      ],
      // Only socket 1 is cabled; socket 2 reaches nothing.
      connections: [
        { from: panelInput("front-left", 1), to: stageboxInput("stagebox-1", 1) },
      ],
    };

    const uncabledMap = aes50ChannelsByEndpoint(withUncabledSocket);

    expect(uncabledMap.get(endpointId(panelInput("front-left", 1)))).toEqual(
      aes50Channel("A", 1),
    );
    expect(uncabledMap.has(endpointId(panelInput("front-left", 2)))).toBe(
      false,
    );
  });
});

describe("deriveOutputEdges", () => {
  it("maps Stagebox V (start 9) onto its output block", () => {
    const edges = deriveOutputEdges(outputVenueInstallation());

    expect(edgeFrom(edges, mixerOutput(13)).to).toEqual(
      stageboxOutput("stagebox-v", 5),
    );
    expect(edgeFrom(edges, mixerOutput(9)).to).toEqual(
      stageboxOutput("stagebox-v", 1),
    );
    expect(edgeFrom(edges, mixerOutput(16)).to).toEqual(
      stageboxOutput("stagebox-v", 8),
    );
  });

  it("maps Stagebox H (start 1) onto its output block", () => {
    const edges = deriveOutputEdges(outputVenueInstallation());

    expect(edgeFrom(edges, mixerOutput(6)).to).toEqual(
      stageboxOutput("stagebox-h", 6),
    );
    expect(edgeFrom(edges, mixerOutput(2)).to).toEqual(
      stageboxOutput("stagebox-h", 2),
    );
    expect(edgeFrom(edges, mixerOutput(8)).to).toEqual(
      stageboxOutput("stagebox-h", 8),
    );
  });

  it("keeps every declared output-side connection", () => {
    const installation = outputVenueInstallation();
    const edges = deriveOutputEdges(installation);

    for (const connection of installation.connections) {
      expect(edges).toContainEqual(connection);
    }
  });

  it("derives nothing for a stagebox with no outputBlock", () => {
    const installation: Installation = {
      devices: [
        {
          id: deviceId("stagebox-1"),
          kind: "stagebox",
          label: "Stagebox 1",
          inputs: 4,
          aes50: { bus: "A", offset: 0 },
        },
      ],
      connections: [],
    };
    expect(deriveOutputEdges(installation)).toEqual([]);
  });

  it("does not leak input-side connections", () => {
    const edges = deriveOutputEdges(venueInstallation());
    expect(edges).toEqual([]);
  });
});
