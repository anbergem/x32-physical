import { describe, expect, it } from "vitest";

import { venueInstallation } from "./__fixtures__/venue";
import type { EndpointRef } from "./endpoints";
import { aes50Channel, endpointId, stageboxInput } from "./endpoints";
import { deviceId } from "./ids";
import { aes50ChannelForInput, deriveStaticEdges } from "./topology";
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
