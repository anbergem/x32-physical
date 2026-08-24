/**
 * Pure topology/routing domain. Imports nothing from infrastructure.
 *
 * Plan step 2 provides the static model: identifiers, endpoints, topology,
 * edge derivation, validation, and the mixer routing types the route index
 * consumes. Step 5 adds route resolution (`buildRouteIndex`) on top.
 */

export type { Aes50Bus, DeviceId, EndpointId, MixerChannelId } from "./ids";
export {
  AES50_CHANNEL_COUNT,
  MIXER_CHANNEL_COUNT,
  aes50Bus,
  deviceId,
  mixerChannelId,
} from "./ids";

export type {
  Aes50ChannelRef,
  EndpointRef,
  MixerChannelRef,
  PanelInputRef,
  StageboxInputRef,
} from "./endpoints";
export {
  aes50Channel,
  endpointId,
  mixerChannel,
  panelInput,
  parseEndpointId,
  stageboxInput,
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
  deriveStaticEdges,
} from "./topology";

export type { MixerChannelState, MixerSourceRef } from "./mixer";
export { mixerSourceRefEquals } from "./mixer";

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
