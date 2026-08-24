/**
 * Mock mode (architecture.md §6): a `MockMixerClient` running *in the browser*,
 * no bridge process needed. Mock-first development (CLAUDE.md invariant 4)
 * means this path drives the complete UX; the WebSocket gateway of plan step 9
 * implements the same `MixerGateway` interface and reuses `applyToStore`.
 */

import type { MockMixerClient, Unsubscribe } from "@x32/mixer-contracts";

import type { AppStore } from "../state/store";

import { applyBaseline, applyMixerEvent, applyMixerSnapshot } from "./applyToStore";
import type { BaselineStore } from "./baselineStore";
import { LocalStorageBaselineStore } from "./baselineStore";
import type { MixerGateway } from "./mixerGateway";

export class LocalMockGateway implements MixerGateway {
  readonly #store: AppStore;
  readonly #baselineStore: BaselineStore;
  #unsubscribe: Unsubscribe | null = null;

  /**
   * The mock is public on purpose: it is this gateway's entire reason to
   * exist, and the dev control surface (plan step 8, mock mode only) drives it
   * directly. Production code depends on `MixerGateway`, which exposes no
   * mutation at all.
   */
  readonly mock: MockMixerClient;

  constructor(
    store: AppStore,
    mock: MockMixerClient,
    baselineStore: BaselineStore = new LocalStorageBaselineStore(),
  ) {
    this.#store = store;
    this.mock = mock;
    this.#baselineStore = baselineStore;
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

    // The mock's own snapshot has nothing to do with the persisted baseline
    // (architecture.md §7) — that comes from localStorage, independently.
    applyBaseline(this.#store, this.#baselineStore.load());
  }

  async disconnect(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    await this.mock.disconnect();
    this.#store.getState().setConnection("disconnected");
  }

  /**
   * Blesses the store's current `channels` as the new baseline and persists
   * it via the `BaselineStore` seam — mock mode's stand-in for the bridge's
   * disk write, per architecture.md §7 ("Mock mode ... persists via
   * localStorage behind a small `BaselineStore` seam").
   */
  saveBaseline(): void {
    const state = this.#store.getState();
    const snapshot = { channels: state.channels, selectedChannel: state.selectedChannel };
    this.#baselineStore.save(snapshot);
    applyBaseline(this.#store, snapshot);
  }
}
