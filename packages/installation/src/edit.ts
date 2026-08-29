/**
 * The installation write pipeline (issue #27, epic #25).
 *
 * The order below is the whole design, and every step earns its place:
 *
 * ```text
 * 1. read the current document                      (repository)
 * 2. reject if baseVersion ≠ the current version    (optimistic concurrency)
 * 3. apply the operation surgically to the Document (comments survive)
 * 4. re-parse and validate the RESULT
 * 5. reject on any error — writing nothing
 * 6. write atomically, previous kept as .bak        (repository)
 * 7. broadcast installation-changed to every client (the caller's job)
 * ```
 *
 * Step 4 is the subtle one: it validates the *result*, never the operation
 * alone. An operation can be entirely sensible in isolation and still leave an
 * invalid installation — cabling a socket another connection already feeds, or
 * a rename applied to a file that was already broken — and only checking the
 * whole resulting document catches that. An invalid `installation.yaml` is
 * never written, so the app can never talk a technician into a topology it
 * would then refuse to load.
 *
 * Steps 2–5 are pure (`editInstallationText`) and steps 1–6 are the same
 * function with a repository around it (`applyInstallationEdit`). Both live
 * here, in the package the bridge and the web app share, so mock mode runs the
 * identical pipeline against an in-memory repository rather than growing a
 * second write path of its own.
 *
 * Rejection is a normal outcome, not a failure to hide: every `reason` below
 * is written to be shown to the operator as-is.
 */

import { parseDocument } from "yaml";

import type { InstallationOperation } from "./operations";
import { applyOperation } from "./operations";
import type { InstallationFileState, InstallationRepository } from "./repository";
import { InstallationVersionConflictError, installationFileState } from "./repository";

export type InstallationEditResult =
  | {
      readonly ok: true;
      /** The document as written, comments and all. */
      readonly state: InstallationFileState;
    }
  | {
      readonly ok: false;
      /** Shown to the operator verbatim. */
      readonly reason: string;
    };

/** What a client is told when it edited against a document that has moved on. */
export const STALE_BASE_VERSION_REASON =
  "The installation file changed since this page loaded it. " +
  "Reload the page, then make the edit again.";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Steps 2–5, pure: no I/O, nothing written. Returns the document that *would*
 * be stored, or the reason it must not be.
 *
 * @param current   the document as the repository holds it right now.
 * @param baseVersion the version the editing client believes it is editing.
 * @param source    how to name the document in parse/validation messages.
 */
export function editInstallationText(
  current: InstallationFileState,
  baseVersion: string,
  operation: InstallationOperation,
  source?: string,
): InstallationEditResult {
  // 2. Optimistic concurrency, before anything is touched.
  if (baseVersion !== current.version) {
    return { ok: false, reason: STALE_BASE_VERSION_REASON };
  }

  // 3. Apply to the parsed *document* — the comment-preserving representation,
  //    not the domain `Installation`, which cannot be serialised back.
  const document = parseDocument(current.text);
  if (document.errors.length > 0) {
    return {
      ok: false,
      reason:
        `The installation file cannot be edited because it is not valid YAML: ` +
        `${document.errors[0]?.message ?? "unknown parse error"}`,
    };
  }

  try {
    applyOperation(document, operation);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }

  // 4/5. Validate the result as a whole, and refuse to write anything if it
  //      does not hold up. `installationFileState` runs the same three-layer
  //      loader the bridge and browser use, so there is one verdict.
  const next = installationFileState(String(document), source);
  if (next.installation === null) {
    return {
      ok: false,
      reason:
        `That edit would leave the installation invalid, so nothing was ` +
        `saved. ${next.error ?? "The result failed validation."}`,
    };
  }

  return { ok: true, state: next };
}

/**
 * The whole pipeline, steps 1–6. The caller owns step 7 (broadcast), because
 * only it knows who is connected.
 *
 * A `write` that conflicts is reported with the same wording as a stale
 * `baseVersion`: from the operator's point of view they are the same event —
 * somebody else got there first — and the fix is the same.
 */
export async function applyInstallationEdit(
  repository: InstallationRepository,
  baseVersion: string,
  operation: InstallationOperation,
  source?: string,
): Promise<InstallationEditResult> {
  let current: InstallationFileState;
  try {
    current = await repository.read();
  } catch (error) {
    return {
      ok: false,
      reason: `The installation file could not be read: ${messageOf(error)}`,
    };
  }

  const edited = editInstallationText(current, baseVersion, operation, source);
  if (!edited.ok) return edited;

  try {
    const written = await repository.write(edited.state.text, current.version);
    return { ok: true, state: written };
  } catch (error) {
    if (error instanceof InstallationVersionConflictError) {
      return { ok: false, reason: STALE_BASE_VERSION_REASON };
    }
    return {
      ok: false,
      reason: `The installation file could not be saved: ${messageOf(error)}`,
    };
  }
}
