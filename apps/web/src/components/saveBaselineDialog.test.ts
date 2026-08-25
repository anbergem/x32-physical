import { describe, expect, it, vi } from "vitest";

import {
  cancelSaveBaselineDialog,
  closedSaveBaselineDialog,
  confirmSaveBaselineDialog,
  openSaveBaselineDialog,
} from "./saveBaselineDialog";

describe("saveBaselineDialog", () => {
  it("opens only when connected", () => {
    expect(openSaveBaselineDialog("connected")).toEqual({ open: true });
    expect(openSaveBaselineDialog("connecting")).toEqual(closedSaveBaselineDialog);
    expect(openSaveBaselineDialog("disconnected")).toEqual(closedSaveBaselineDialog);
  });

  it("confirming calls saveBaseline exactly once and closes the dialog", () => {
    const saveBaseline = vi.fn();
    const next = confirmSaveBaselineDialog(saveBaseline);
    expect(saveBaseline).toHaveBeenCalledTimes(1);
    expect(next).toEqual(closedSaveBaselineDialog);
  });

  it("cancelling never calls saveBaseline", () => {
    const next = cancelSaveBaselineDialog();
    expect(next).toEqual(closedSaveBaselineDialog);
  });
});
