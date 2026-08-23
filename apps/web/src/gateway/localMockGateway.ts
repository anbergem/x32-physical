/**
 * Mock mode (architecture.md §6): a `MockMixerClient` running *in the browser*,
 * no bridge process needed. Mock-first development (CLAUDE.md invariant 4)
 * means this path drives the complete UX; the WebSocket gateway of plan step 9
 * implements the same `MixerGateway` interface and reuses `applyToStore`.
 */

import type { MockMixerClient, Unsubscribe } from "@x32/mixer-contracts";

import type { AppStore } from "../state/store";

import { applyMixerEvent, applyMixerSnapshot } from "./applyToStore";
import type { MixerGateway } from "./mixerGateway";

export class LocalMockGateway implements MixerGateway {
  readonly #store: AppStore;
  #unsubscribe: Unsubscribe | null = null;

  /**
   * The mock is public on purpose: it is this gateway's entire reason to
   * exist, and the dev control surface (plan step 8, mock mode only) drives it
   * directly. Production code depends on `MixerGateway`, which exposes no
   * mutation at all.
   */
  readonly mock: MockMixerClient;

  constructor(store: AppStore, mock: MockMixerClient) {
    this.#store = store;
    this.mock = mock;
  }

  async connect(): Promise<void> {
    // Subscribe before connecting so no event can slip through the gap, then
    // let the snapshot establish the baseline the events amend.
    this.#unsubscribe ??= this.mock.subscribe((event) => {
      applyMixerEvent(this.#store, event);
    });

    this.#store.getState().setConnection("connecting");
    await this.mock.connect();

    const snapshot = await this.mock.getSnapshot();
    applyMixerSnapshot(this.#store, snapshot, this.mock.getConnectionState());
  }

  async disconnect(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    await this.mock.disconnect();
    this.#store.getState().setConnection("disconnected");
  }
}
