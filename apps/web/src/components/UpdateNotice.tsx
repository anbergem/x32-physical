/**
 * The in-app update notice (docs/plan.md step 20, architecture.md §7): an
 * unobtrusive link in the header, shown only when the bridge's GitHub
 * Releases check has found something newer than the running build. This is
 * a convenience notice, not an update mechanism — clicking it only opens the
 * release page; the tech still downloads and double-clicks the MSI by hand.
 *
 * Hidden entirely when there is nothing to report (`updateAvailable` is
 * `null` — always the case in mock mode, since `LocalMockGateway` has no
 * bridge to check with). The link's `href` is only ever the parsed, guarded
 * `https://` URL from `@x32/protocol`'s parser (`parse.ts` rejects anything
 * else before it reaches the store) — this component does not re-validate
 * it, but never renders anything that did not come through that guard.
 */

import { isSafeUpdateUrl } from "../format/updateNotice";
import { selectUpdateAvailable } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function UpdateNotice() {
  const update = useAppStore(selectUpdateAvailable);
  if (update === null) return null;

  // Defense in depth: `@x32/protocol`'s parser is the primary guard against
  // a non-https URL ever reaching the store, but this component never
  // renders a link it has not itself re-checked either — belt and braces
  // against any future write path that bypasses the wire parser.
  if (!isSafeUpdateUrl(update.url)) return null;

  return (
    <a
      className="update-notice"
      href={update.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      Update available (v{update.version})
    </a>
  );
}
