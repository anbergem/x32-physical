/**
 * The one header control for showing/hiding the five top-level schematic
 * sections (see `sectionVisibility.ts` for the persisted shape and the
 * rationale for keeping this out of the store). A single compact trigger
 * opening a small popover with a labelled checkbox per section — five
 * always-visible chips would crowd the one thing in the header that must
 * stay glanceable (diagnostics, save, the MOCK DATA tag, connection status).
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

import type { SectionId, SectionVisibility } from "./sectionVisibility";

const SECTION_LABELS: Record<SectionId, string> = {
  stage: "Stage areas",
  destinations: "Destinations",
  console: "Console (FOH)",
  channels: "X32 input channels",
  outputs: "X32 output slots",
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

  function toggle(id: SectionId): void {
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
          {(Object.keys(SECTION_LABELS) as SectionId[]).map((id, index) => (
            <label key={id} className="sections-control__item">
              <input
                ref={index === 0 ? firstCheckboxRef : undefined}
                type="checkbox"
                checked={visibility[id]}
                onChange={() => toggle(id)}
              />
              {SECTION_LABELS[id]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
