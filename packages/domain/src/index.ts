/**
 * Pure topology/routing domain. Imports nothing from infrastructure.
 *
 * Plan step 2 provides the static model: identifiers, endpoints, topology,
 * edge derivation, validation, and the mixer routing types the route index
 * consumes. Step 5 adds route resolution (`buildRouteIndex`) on top.
 */

export type {
  Aes50Bus,
  DeviceId,
  EndpointId,
  MixerChannelId,
} from "./ids";
export {
  AES50_CHANNEL_COUNT,
  MIXER_CHANNEL_COUNT,
  MIXER_OUTPUT_COUNT,
  aes50Bus,
  deviceId,
  mixerChannelId,
} from "./ids";

export type {
  Aes50ChannelRef,
  ConsoleOutputRef,
  DestinationRef,
  EndpointRef,
  MixerChannelRef,
  MixerOutputRef,
  PanelInputRef,
  StageboxInputRef,
  StageboxOutputRef,
} from "./endpoints";
export {
  aes50Channel,
  cloneEndpoint,
  compareEndpoints,
  consoleOutput,
  destination,
  endpointId,
  mixerChannel,
  mixerOutput,
  panelInput,
  parseEndpointId,
  stageboxInput,
  stageboxOutput,
} from "./endpoints";

export type {
  Device,
  DeviceKind,
  Installation,
  TopologyEdge,
} from "./topology";
export {
  aes50ChannelForInput,
  aes50ChannelsByEndpoint,
  deriveOutputEdges,
  deriveStaticEdges,
} from "./topology";

export type { MixerChannelState, MixerSourceRef } from "./mixer";
export { mixerSourceRefEquals } from "./mixer";

export type { MixerOutputSourceRef, MixerOutputState } from "./output-mixer";
export { mixerOutputSourceRefEquals } from "./output-mixer";

export type { OutputRoute, OutputRouteIndex } from "./output-routing";
export { buildOutputRouteIndex } from "./output-routing";

export type {
  Aes50BusLinkState,
  Aes50Chain,
  Aes50ChainBox,
  Aes50ChainDiscrepancy,
  Aes50LinkState,
} from "./aes50";
export { aes50ChainEquals, aes50LinkStateEquals, compareAes50Chain } from "./aes50";

export type { RoutingDiscrepancy } from "./routing-diff";
export { compareRouting } from "./routing-diff";

export type { RouteIndex, SignalRoute } from "./routing";
export { buildRouteIndex } from "./routing";

export type {
  InstallationValidationError,
  InstallationValidationErrorCode,
} from "./validation";
export { assertValidInstallation, validateInstallation } from "./validation";

/**
 * Scaffolding marker still imported by the placeholder sources in
 * `mixer-contracts` and `protocol` (plan steps 4 and 9).
 */
export const PACKAGE_NAME = "@x32/domain" as const;
