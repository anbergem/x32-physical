/**
 * The one header control that puts this browser into edit mode (issue #27).
 *
 * Edit mode is explicit, off by default, and never persisted: this app is read
 * at a glance during a live service, and nobody may ever wonder whether they
 * are looking at the venue or changing it. So the trigger is a plain toggle
 * with an unmistakable on-state, and `App` paints the whole page while it is
 * on — an outline plus a banner naming what is happening, not a subtle tint.
 *
 * The state lives in the store's runtime slice rather than in component state
 * (unlike `sectionVisibility.ts`, which is persisted local UI state) because
 * every device frame in the schematic needs to know: a frame's label becomes a
 * button only while editing. A boolean in the store is the cheapest thing
 * ~20 frames can subscribe to, and the store has no persistence of any kind,
 * which is precisely the property "am I editing?" needs.
 */

import { selectEditMode, selectSetEditMode } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function EditModeControl() {
  const editMode = useAppStore(selectEditMode);
  const setEditMode = useAppStore(selectSetEditMode);

  return (
    <button
      type="button"
      className={`edit-mode${editMode ? " edit-mode--on" : ""}`}
      aria-pressed={editMode}
      onClick={() => setEditMode(!editMode)}
    >
      {editMode ? "Done editing" : "Edit installation"}
    </button>
  );
}
