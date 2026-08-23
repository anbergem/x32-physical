/**
 * Dev-only demo sequence (`X32_DEMO=1`, off by default).
 *
 * Not part of the production read path: it drives the bridge's own
 * `MockMixerClient` through its `simulate*` API purely so a developer
 * watching the browser can see live bridge → web events flow without an X32
 * plugged in. Every step goes through the exact same event path a real
 * console press would (mock → bridge subscription → WS fan-out), matching
 * architecture.md §8.
 */

import { mixerChannelId } from "@x32/domain";
import type { MockMixerClient } from "@x32/mixer-contracts";

/** ~3s between steps, per the plan step's spec. */
const INTERVAL_MS = 3000;

const CH3 = mixerChannelId(3);
const CH7 = mixerChannelId(7);
const CH12 = mixerChannelId(12);
const CH20 = mixerChannelId(20);
const CH28 = mixerChannelId(28);

type DemoStep = (mock: MockMixerClient) => void;

/** A small, clearly-labelled loop: a few selections, a rename, a re-route, a deselect. */
const STEPS: readonly DemoStep[] = [
  (mock) => mock.simulateSelect(CH3),
  (mock) => mock.simulateSelect(CH12),
  (mock) => mock.simulateRename(CH7, "Demo Vox"),
  (mock) =>
    mock.simulateSourceChange(CH28, { kind: "aes50", bus: "A", channel: 9 }),
  (mock) => mock.simulateSelect(null),
  (mock) => mock.simulateSelect(CH20),
];

/** Starts the scripted cycle; returns a function that stops it. */
export function startDemoMode(mock: MockMixerClient): () => void {
  let index = 0;
  const timer = setInterval(() => {
    STEPS[index % STEPS.length]?.(mock);
    index += 1;
  }, INTERVAL_MS);

  return () => clearInterval(timer);
}
