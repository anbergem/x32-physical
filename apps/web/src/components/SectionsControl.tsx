/**
 * The one header control for showing/hiding the top-level schematic sections
 * (see `sectionVisibility.ts` for the persisted shape, the input/output
 * grouping, and the rationale for keeping this out of the store). A single
 * compact trigger opening a small popover — a row of always-visible chips
 * would crowd the one thing in the header that must stay glanceable
 * (diagnostics, save, the MOCK DATA tag, connection status).
 *
 * The popover is two groups, each headed by its own toggle: the two halves
 * of the signal path are what a tech actually switches between, so "all
 * inputs" / "all outputs" are first-class rows rather than something to
 * assemble from six individual checkboxes. A group toggle is a genuine
 * tri-state control — checked when its whole group is shown, indeterminate
 * when only part of it is, unchecked when none is — because a group that is
 * half shown must say so rather than round to a side. Clicking one shows the
 * whole group unless it was already whole, in which case it hides it
 * (`toggleGroup`).
 *
 * Because the trigger always lives in the header, hiding every section is
 * recoverable by construction: the popover lists every section with its
 * checkbox regardless of current visibility, so "everything hidden" is never
 * a dead end.
 *
 * Focus contract mirrors `DiagnosticsControl`'s hand-rolled dialog: focus
 * moves into the popover on open and back to the trigger on close. Unlike
 * that dialog this is a non-modal popover (checkboxes, not a single
 * confirm/cancel action), so it also closes on an outside click, in addition
 * to Escape and re-clicking the trigger.
 */

import { useEffect, useRef, useState } from "react";

import {
  groupState,
  SECTION_GROUP_IDS,
  sectionsInGroup,
  toggleGroup,
} from "./sectionVisibility";
import type { SectionGroupId, SectionId, SectionVisibility } from "./sectionVisibility";

const SECTION_LABELS: Record<SectionId, string> = {
  stage: "Stage areas",
  consoleInputs: "Mikserpult (FOH)",
  channels: "X32 input channels",
  destinations: "Destinations",
  consoleOutputs: "Console XLR outs",
  outputs: "X32 output slots",
};

const GROUP_LABELS: Record<SectionGroupId, string> = {
  inputs: "All inputs",
  outputs: "All outputs",
};

export function SectionsControl({
  visibility,
  onChange,
}: {
  visibility: SectionVisibility;
  onChange: (visibility: SectionVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      firstCheckboxRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  function toggleSection(id: SectionId): void {
    onChange({ ...visibility, [id]: !visibility[id] });
  }

  return (
    <div className="sections-control">
      <button
        ref={triggerRef}
        type="button"
        className="sections-control__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        Sections
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="sections-control__popover"
          role="menu"
          aria-label="Toggle visible sections"
        >
          {SECTION_GROUP_IDS.map((group, groupIndex) => {
            const state = groupState(visibility, group);
            return (
              <div className="sections-control__group" key={group}>
                <label className="sections-control__item sections-control__item--group">
                  <input
                    ref={(element) => {
                      if (element !== null) {
                        // The only way to express "partly shown" on a
                        // checkbox — it is a DOM property, not an attribute,
                        // so React cannot set it from JSX.
                        element.indeterminate = state === "some";
                      }
                      if (groupIndex === 0) {
                        firstCheckboxRef.current = element;
                      }
                    }}
                    type="checkbox"
                    checked={state === "all"}
                    onChange={() => onChange(toggleGroup(visibility, group))}
                  />
                  {GROUP_LABELS[group]}
                </label>
                {sectionsInGroup(group).map((id) => (
                  <label key={id} className="sections-control__item">
                    <input
                      type="checkbox"
                      checked={visibility[id]}
                      onChange={() => toggleSection(id)}
                    />
                    {SECTION_LABELS[id]}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
