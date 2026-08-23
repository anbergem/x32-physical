/**
 * `MixerClient` interface, snapshot/event types and `MockMixerClient`.
 * Depends on domain types only — never the reverse.
 */

export type {
  MixerClient,
  MixerConnectionState,
  MixerEvent,
  MixerEventListener,
  MixerSnapshot,
  Unsubscribe,
} from "./client";

export { createDefaultMockSnapshot } from "./default-snapshot";
export { MockMixerClient } from "./mock";

/**
 * Scaffolding marker still imported by the `protocol` placeholder (plan step 9)
 * and the web app's placeholder screen (step 6).
 */
export const PACKAGE_NAME = "@x32/mixer-contracts" as const;
