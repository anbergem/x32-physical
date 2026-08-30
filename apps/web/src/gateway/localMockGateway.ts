/**
 * Mock mode (architecture.md §6): a `MockMixerClient` running *in the browser*,
 * no bridge process needed. Mock-first development (CLAUDE.md invariant 4)
 * means this path drives the complete UX; the WebSocket gateway of plan step 9
 * implements the same `MixerGateway` interface and reuses `applyToStore`.
 *
 * The installation editor (issue #27) is mock-first too: edits run the very
 * same `applyInstallationEdit` pipeline the bridge runs, against an
 * `InMemoryInstallationRepository` instead of the disk. That keeps the editor
 * demonstrable from a clone of this repo with no console and no venue file to
 * risk, and it means the pipeline — precondition, surgical apply, validate the
 * result — is exercised on both sides rather than duplicated on one.
 * "Persisted" here lasts as long as the tab does, and the UI says so rather
 * than implying an edit was saved somewhere.
 */

import type { InstallationOperation, InstallationRepository } from "@x32/installation";
import { applyInstallationEdit, InMemoryInstallationRepository } from "@x32/installation";
import type { MockMixerClient, Unsubscribe } from "@x32/mixer-contracts";

import type { AppStore } from "../state/store";

import {
  applyBaseline,
  applyInstallation,
  applyInstallationEditError,
  applyMeterLevels,
  applyMixerEvent,
  applyMixerSnapshot,
} from "./applyToStore";
import type { BaselineStore } from "./baselineStore";
import { LocalStorageBaselineStore } from "./baselineStore";
import type { MixerGateway } from "./mixerGateway";

export class LocalMockGateway implements MixerGateway {
  readonly #store: AppStore;
  readonly #baselineStore: BaselineStore;
  readonly #installationRepository: InstallationRepository;
  #unsubscribe: Unsubscribe | null = null;
  #unsubscribeMeters: Unsubscribe | null = null;

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
    installationRepository: InstallationRepository = emptyInstallationRepository(),
  ) {
    this.#store = store;
    this.mock = mock;
    this.#baselineStore = baselineStore;
    this.#installationRepository = installationRepository;
  }

  async connect(): Promise<void> {
    // Subscribe before connecting so no event can slip through the gap, then
    // let the snapshot establish the baseline the events amend.
    this.#unsubscribe ??= this.mock.subscribe((event) => {
      applyMixerEvent(this.#store, event);
    });
    // Meters (step 15) ride their own path, not `MixerEvent` — same
    // subscribe-before-connect discipline, so no level tick can slip through
    // the gap once `simulateMetersStart()` is toggled on.
    this.#unsubscribeMeters ??= this.mock.subscribeMeters((levels) => {
      applyMeterLevels(this.#store, levels);
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
    this.#unsubscribeMeters?.();
    this.#unsubscribeMeters = null;
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
    const snapshot = {
      channels: state.channels,
      // Outputs belong in the baseline too: without them "save as correct"
      // blesses only the input half, and an output re-patch would never show
      // up as a deviation (issue #31 made this omission a type error).
      outputs: state.outputs,
      selectedChannel: state.selectedChannel,
    };
    this.#baselineStore.save(snapshot);
    applyBaseline(this.#store, snapshot);
  }

  /**
   * Mock mode's stand-in for the bridge's disk write: the identical pipeline
   * (`@x32/installation`'s `applyInstallationEdit`), an in-memory repository
   * instead of a file, and the result pushed into the same store slices the
   * live gateway's `installation-changed`/`installation-edit-rejected`
   * messages land in.
   *
   * Fire-and-forget to match the interface; the pipeline is async only because
   * the repository seam is.
   */
  applyInstallationEdit(baseVersion: string, operation: InstallationOperation): void {
    void applyInstallationEdit(this.#installationRepository, baseVersion, operation).then(
      (result) => {
        if (!result.ok) {
          applyInstallationEditError(this.#store, result.reason);
          return;
        }
        if (result.state.installation === null) return;
        applyInstallation(this.#store, result.state.installation, result.state.version);
        applyInstallationEditError(this.#store, null);
      },
    );
  }
}

/**
 * The fallback when no repository is supplied — a document that is not an
 * installation, so every edit is refused with the loader's own message. Only
 * reachable from a test that constructs the gateway directly; `main.tsx`
 * always hands over a repository seeded with the document it fetched.
 */
function emptyInstallationRepository(): InstallationRepository {
  return new InMemoryInstallationRepository("");
}
