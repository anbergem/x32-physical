/**
 * The store the installation document lives in, and the optimistic-concurrency
 * token that guards writes to it (issue #27, epic #25).
 *
 * Two implementations exist. The disk-backed one is the bridge's
 * (`apps/x32-bridge/src/installationRepository.ts` — it needs `node:fs`, which
 * this package's index entry point may never reach for). The in-memory one is
 * here, next to the interface, because it is needed on *both* sides: the
 * bridge's tests drive the write pipeline through it, and the web app's mock
 * mode is backed by it so the editor can be demonstrated without a bridge
 * write path at all. Web code cannot import from `apps/x32-bridge`, so a
 * repository shared by both has to live in a package — and this is the package
 * that already owns YAML↔domain.
 *
 * **`version` is a content hash of the document text.** Two browsers on a
 * venue LAN is an ordinary situation, and a stale write silently clobbering
 * someone else's edit is not an acceptable outcome; a rejection is cheap and
 * recoverable. A hash rather than a counter means the token needs nothing
 * persisted alongside the file, survives a bridge restart, and correctly
 * reports "changed" when a tech edits the file in Notepad behind the app's
 * back.
 *
 * **`installation` may be `null`.** A present-but-invalid file is a state the
 * bridge already tolerates at startup (it logs once and 404s
 * `/api/installation` rather than refusing to start), so reading one must not
 * throw either — the write pipeline still has to be able to read it, reject
 * the edit, and say why. Only an unreadable file (I/O failure) throws.
 */

import type { Installation } from "@x32/domain";

import { parseInstallationYaml } from "./parse";

/** A document as it currently stands, with the token needed to write over it. */
export interface InstallationFileState {
  /** The exact bytes — what `GET /api/installation` serves verbatim. */
  readonly text: string;
  /** Content hash of `text`; the `baseVersion` an edit must match. */
  readonly version: string;
  /** `null` when `text` does not currently parse and validate. */
  readonly installation: Installation | null;
  /** The loader's own layered message when `installation` is `null`. */
  readonly error: string | null;
}

export interface InstallationRepository {
  /**
   * The document as it stands.
   *
   * @throws Error when the document cannot be *read* at all (a missing file,
   *         a permissions failure). A document that reads but does not parse
   *         or validate is not an error here — it comes back with
   *         `installation: null` and `error` set.
   */
  read(): Promise<InstallationFileState>;

  /**
   * Replaces the document with `text`.
   *
   * @param expectedVersion the version the caller read and based its edit on.
   * @throws InstallationVersionConflictError when the stored document is no
   *         longer at `expectedVersion` — checked again here, not only by the
   *         caller, so two edits racing between read and write cannot both
   *         land.
   */
  write(text: string, expectedVersion: string): Promise<InstallationFileState>;
}

/** The stored document moved on while an edit was in flight. */
export class InstallationVersionConflictError extends Error {
  readonly expectedVersion: string;
  readonly actualVersion: string;

  constructor(expectedVersion: string, actualVersion: string) {
    super(
      `The installation file changed while this edit was in flight ` +
        `(expected version ${expectedVersion}, found ${actualVersion}).`,
    );
    this.name = "InstallationVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const SIXTY_FOUR_BITS = 0xffffffffffffffffn;

/**
 * The document's version token: 64-bit FNV-1a over its code units, as 16 hex
 * digits.
 *
 * Deliberately not a cryptographic digest: nothing here defends against a
 * crafted collision, only against two honest editors racing, and `node:crypto`
 * is unavailable to the browser half of this package. Deliberately not a
 * counter either — a hash of the content is also correct when the file is
 * edited outside the app entirely, in Notepad.
 *
 * It reaches for no global at all (not even `TextEncoder`): this module is
 * type-checked under `@x32/protocol`'s configuration too, which has neither
 * DOM nor Node libs, and a version token has no business depending on either.
 */
export function installationVersion(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    hash = ((hash ^ BigInt(unit & 0xff)) * FNV_PRIME) & SIXTY_FOUR_BITS;
    hash = ((hash ^ BigInt(unit >>> 8)) * FNV_PRIME) & SIXTY_FOUR_BITS;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Text → the state every repository returns: hashed, and parsed through the
 * one loader (`parseInstallationYaml`) so a repository can never disagree with
 * the browser about what a document means. Never throws — an invalid document
 * is a value here, not an exception.
 *
 * @param source how to name the document in the parser's error messages —
 *               the bridge passes the file path.
 */
export function installationFileState(
  text: string,
  source?: string,
): InstallationFileState {
  const version = installationVersion(text);
  try {
    return {
      text,
      version,
      installation: parseInstallationYaml(text, source),
      error: null,
    };
  } catch (error) {
    return {
      text,
      version,
      installation: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A repository holding one document in memory. Used by the bridge's tests and
 * by the web app's mock mode, where "persisted" means "for as long as this tab
 * is open" — the UI says so rather than pretending an edit survived (issue
 * #27).
 */
export class InMemoryInstallationRepository implements InstallationRepository {
  #state: InstallationFileState;
  readonly #source: string | undefined;

  constructor(text: string, source?: string) {
    this.#source = source;
    this.#state = installationFileState(text, source);
  }

  /** The exact stored bytes — what a "nothing was written" assertion reads. */
  get text(): string {
    return this.#state.text;
  }

  async read(): Promise<InstallationFileState> {
    return this.#state;
  }

  async write(text: string, expectedVersion: string): Promise<InstallationFileState> {
    if (this.#state.version !== expectedVersion) {
      throw new InstallationVersionConflictError(expectedVersion, this.#state.version);
    }
    this.#state = installationFileState(text, this.#source);
    return this.#state;
  }
}
