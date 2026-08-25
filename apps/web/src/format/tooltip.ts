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
  DestinationRef,
  EndpointId,
  EndpointRef,
  Installation,
  MixerChannelId,
  MixerChannelState,
  MixerOutputState,
  OutputRoute,
  OutputRouteIndex,
  RouteIndex,
  RoutingDiscrepancy,
  SignalRoute,
} from "@x32/domain";
import { parseEndpointId } from "@x32/domain";

import { outputSlotsFor } from "../installation/outputLabels";
import { physicalOutputDestinationsFor } from "../installation/outputCabling";

import { formatMixerOutputSource } from "./outputSource";
import { formatMixerSource } from "./source";

export interface TooltipContext {
  installation: Installation;
  routeIndex: RouteIndex;
  channels: MixerChannelState[];
  /** Baseline diff (architecture.md §3), `[]` without a baseline (step 14). */
  discrepancies: RoutingDiscrepancy[];
  /** Output-side route index (issue #11) — mirrors `routeIndex` for the output half of the schematic. */
  outputRouteIndex: OutputRouteIndex;
  outputs: MixerOutputState[];
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
    // Output-side endpoint kinds (issue #11).
    case "mixer-output":
      return `Out ${ref.output}`;
    case "console-output":
      return `Console Out ${ref.output}`;
    case "stagebox-output":
      return `${deviceLabel(ref.device, installation)} · Out ${ref.output}`;
    case "destination":
      return deviceLabel(ref.device, installation);
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
  switch (ref.kind) {
    case "mixer-channel":
      return describeChannel(ref.channel, context);
    case "mixer-output":
      return describeOutputSlot(ref.output, context);
    case "console-output":
    case "stagebox-output":
      return describePhysicalOutput(ref, endpoint, context);
    case "destination":
      return describeDestination(ref, context);
    default:
      return describePhysical(ref, endpoint, context);
  }
}

/** "Which socket does this channel come from?" */
function describeChannel(
  channel: MixerChannelId,
  { installation, routeIndex, channels, discrepancies }: TooltipContext,
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
      ...discrepancyLines(channel, discrepancies),
    ],
  };
}

/**
 * The diagnostic tail of a channel's tooltip (architecture.md §3, plan step
 * 14): `source-mismatch` and `unexpected-shared-source` explain the badge
 * already on the strip; `name-mismatch` is informational-only — it never
 * badges the strip, so this line is the only place it appears at all.
 */
function discrepancyLines(
  channel: MixerChannelId,
  discrepancies: RoutingDiscrepancy[],
): string[] {
  const lines: string[] = [];

  for (const discrepancy of discrepancies) {
    if (discrepancy.kind === "source-mismatch" && discrepancy.channel === channel) {
      lines.push(
        `Expected: ${formatMixerSource(discrepancy.expected)} / Actual: ${formatMixerSource(discrepancy.actual)}`,
      );
    }
    if (discrepancy.kind === "name-mismatch" && discrepancy.channel === channel) {
      lines.push(`Baseline name: ${discrepancy.expected}`);
    }
    if (
      discrepancy.kind === "unexpected-shared-source" &&
      discrepancy.channels.includes(channel)
    ) {
      const others = discrepancy.channels.filter((candidate) => candidate !== channel);
      lines.push(
        `Unexpectedly shares its source with ${others.map((c) => `CH${c}`).join(", ")}`,
      );
    }
  }

  return lines;
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

// --- output side (issue #11) ------------------------------------------------

/** "Where does this Out slot's signal go?" */
function describeOutputSlot(
  output: number,
  { installation, outputs, outputRouteIndex }: TooltipContext,
): EndpointDescription {
  const title = `Out ${output}`;
  const state = outputs.find((candidate) => candidate.output === output);
  if (state === undefined) {
    return { title, lines: ["No mixer data yet"] };
  }

  const route = outputRouteIndex.byMixerOutput.get(output);
  const line = outputDestinationLine(route, installation);

  return { title, lines: [formatMixerOutputSource(state.source), line] };
}

/** The destination-summary line shared by `describeOutputSlot` and `describePhysicalOutput`. */
function outputDestinationLine(
  route: OutputRoute | undefined,
  installation: Installation,
): string {
  if (route?.unroutedSource !== undefined) return "OFF — not routed";
  // `OutputRoute.destinations` is typed as the general `EndpointRef` union,
  // but every entry the domain puts there is always `kind: "destination"`
  // (`destinationsOf` in `output-routing.ts`) — narrow rather than assert.
  const destinations = (route?.destinations ?? []).filter(
    (ref): ref is DestinationRef => ref.kind === "destination",
  );
  return destinations.length === 0
    ? "Not cabled to a destination"
    : `→ ${destinations.map((ref) => deviceLabel(ref.device, installation)).join(", ")}`;
}

/**
 * "What does this physical output socket carry, and what is cabled to it?"
 *
 * The wholesale-block distinction (issue #11) lives here: `outputSlotsFor`
 * gives the console Out slot this exact socket carries as a structural fact,
 * independent of `OutputRouteIndex` — and `physicalOutputDestinationsFor`
 * answers "is *this* socket declared cabled?" the same way, never through
 * the shared route's `destinations` (which would read identically for a
 * wholesale-uncabled socket and its block's cabled sibling — see
 * `installation/outputCabling.ts`). A socket that carries a block but has
 * nothing plugged into it reads "carries Out N · nothing connected",
 * distinct from a cabled one's "carries Out N → Destination".
 */
function describePhysicalOutput(
  ref: EndpointRef,
  endpoint: EndpointId,
  { installation }: TooltipContext,
): EndpointDescription {
  const title = formatEndpoint(ref, installation);
  const slot = outputSlotsFor(installation).get(endpoint);
  const cabledTo = physicalOutputDestinationsFor(installation).get(endpoint);

  if (slot === undefined) {
    return { title, lines: ["No console Out slot mapped"] };
  }

  const line =
    cabledTo === undefined
      ? `Carries Out ${slot} · nothing connected`
      : `Carries Out ${slot} → ${deviceLabel(cabledTo.device, installation)}`;

  return { title, lines: [line] };
}

/**
 * "Which output feeds this destination, and via which physical socket?" —
 * the full upstream chain, e.g. `Front Venstre ← Stagebox V out 5 ← Out 13 ←
 * Bus 1`. Built from the declared cabling (`physicalOutputDestinationsFor`)
 * and the structural slot mapping (`outputSlotsFor`) rather than from
 * `OutputRouteIndex`, for the same reason `describePhysicalOutput` does —
 * a destination's own tooltip must never suggest a wholesale-uncabled
 * sibling socket feeds it.
 */
function describeDestination(
  ref: DestinationRef,
  { installation, outputs }: TooltipContext,
): EndpointDescription {
  const title = deviceLabel(ref.device, installation);
  const outputSlots = outputSlotsFor(installation);

  const feeders: EndpointId[] = [];
  for (const [physicalId, dest] of physicalOutputDestinationsFor(installation)) {
    if (dest.device === ref.device) feeders.push(physicalId);
  }

  if (feeders.length === 0) {
    return { title, lines: ["Nothing cabled to this destination"] };
  }

  const lines = feeders.sort().map((physicalId) => {
    const physicalRef = parseEndpointId(physicalId);
    const physicalLabel = formatEndpoint(physicalRef, installation);
    const slot = outputSlots.get(physicalId);
    if (slot === undefined) return `${title} ← ${physicalLabel}`;

    const state = outputs.find((candidate) => candidate.output === slot);
    const sourceLabel =
      state === undefined ? undefined : formatMixerOutputSource(state.source);

    return sourceLabel === undefined
      ? `${title} ← ${physicalLabel} ← Out ${slot}`
      : `${title} ← ${physicalLabel} ← Out ${slot} ← ${sourceLabel}`;
  });

  return { title, lines };
}
