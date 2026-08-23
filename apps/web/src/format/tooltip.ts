/**
 * What a hovered endpoint says about itself.
 *
 * Pure functions over the store's slices: no React, no DOM, so the wording is
 * unit-tested directly. Everything comes from the precomputed `RouteIndex` —
 * this module answers the product's two questions ("which channels consume
 * this socket?", "which socket does this channel come from?") by *reading* a
 * route, never by walking the topology.
 */

import type {
  EndpointId,
  EndpointRef,
  Installation,
  MixerChannelId,
  MixerChannelState,
  RouteIndex,
  SignalRoute,
} from "@x32/domain";
import { parseEndpointId } from "@x32/domain";

import { formatMixerSource } from "./source";

export interface TooltipContext {
  installation: Installation;
  routeIndex: RouteIndex;
  channels: MixerChannelState[];
}

export interface EndpointDescription {
  /** The endpoint's own identity, e.g. `CH12 · Keys R`. */
  title: string;
  /** Detail lines, most relevant first. Never empty. */
  lines: string[];
}

/** `Front Left · Input 3`, `Stagebox 2 · Input 7`, `AES50-A 23`, `CH12`. */
export function formatEndpoint(
  ref: EndpointRef,
  installation: Installation,
): string {
  switch (ref.kind) {
    case "panel-input":
    case "stagebox-input":
      return `${deviceLabel(ref.device, installation)} · Input ${ref.input}`;
    case "aes50-channel":
      return `AES50-${ref.bus} ${ref.channel}`;
    case "mixer-channel":
      return `CH${ref.channel}`;
  }
}

function deviceLabel(device: string, installation: Installation): string {
  const match = installation.devices.find(
    (candidate) => candidate.id === device,
  );
  return match?.label ?? device;
}

/** The console's name for a channel, if it has a non-blank one. */
function channelName(
  channel: MixerChannelId,
  channels: MixerChannelState[],
): string | undefined {
  const name = channels
    .find((candidate) => candidate.channel === channel)
    ?.name.trim();
  return name === undefined || name === "" ? undefined : name;
}

/** `CH23 Podium` — the compact form used inside a list of consumers. */
function channelLabel(
  channel: MixerChannelId,
  channels: MixerChannelState[],
): string {
  const name = channelName(channel, channels);
  return name === undefined ? `CH${channel}` : `CH${channel} ${name}`;
}

/** `CH12 · Keys R` — the form used as a tooltip title. */
function channelTitle(
  channel: MixerChannelId,
  channels: MixerChannelState[],
): string {
  const name = channelName(channel, channels);
  return name === undefined ? `CH${channel}` : `CH${channel} · ${name}`;
}

export function describeEndpoint(
  endpoint: EndpointId,
  context: TooltipContext,
): EndpointDescription {
  const ref = parseEndpointId(endpoint);
  return ref.kind === "mixer-channel"
    ? describeChannel(ref.channel, context)
    : describePhysical(ref, endpoint, context);
}

/** "Which socket does this channel come from?" */
function describeChannel(
  channel: MixerChannelId,
  { installation, routeIndex, channels }: TooltipContext,
): EndpointDescription {
  const title = channelTitle(channel, channels);
  const state = channels.find((candidate) => candidate.channel === channel);
  if (state === undefined) {
    // Before the first snapshot the strip exists but nothing is known yet.
    return { title, lines: ["No mixer data yet"] };
  }

  const route = routeIndex.byMixerChannel.get(channel);
  const physical = route?.physicalInputs ?? [];

  return {
    title,
    lines: [
      formatMixerSource(state.source),
      physical.length === 0
        ? "No mapped physical input"
        : physical
            .map((input) => formatEndpoint(input, installation))
            .join(", "),
    ],
  };
}

/** "Which channel(s) consume this socket?" */
function describePhysical(
  ref: EndpointRef,
  endpoint: EndpointId,
  { installation, routeIndex, channels }: TooltipContext,
): EndpointDescription {
  const routes = routeIndex.byEndpoint.get(endpoint) ?? [];

  return {
    title: formatEndpoint(ref, installation),
    lines: [destinationLine(routes, installation), consumerLine(routes, channels)],
  };
}

/** Where the signal goes next on the bus, e.g. `→ AES50-A 23`. */
function destinationLine(
  routes: SignalRoute[],
  installation: Installation,
): string {
  const buses = new Set<string>();
  for (const route of routes) {
    for (const id of route.endpoints) {
      const ref = parseEndpointId(id);
      if (ref.kind === "aes50-channel") {
        buses.add(formatEndpoint(ref, installation));
      }
    }
  }

  return buses.size === 0
    ? "Not cabled to a stagebox"
    : `→ ${[...buses].join(", ")}`;
}

/** Every channel consuming this socket — the fan-out, `CH23 …, CH28 …`. */
function consumerLine(
  routes: SignalRoute[],
  channels: MixerChannelState[],
): string {
  const consumers = new Set<MixerChannelId>();
  for (const route of routes) {
    for (const channel of route.mixerChannels) consumers.add(channel);
  }

  if (consumers.size === 0) return "No channel consumes this input";

  return [...consumers]
    .sort((a, b) => a - b)
    .map((channel) => channelLabel(channel, channels))
    .join(", ");
}
