/**
 * AES50 link/chain warning text (issue #17). Pure formatting, unit-tested
 * directly — no React, no store reads (`SystemStatus.tsx` reads the store
 * through `../state/selectors` and hands the results here).
 *
 * The headline case's wording matters more than most in this app: a dead
 * AES50 snake looks identical to "nobody is talking into the mics" without
 * it — sources still display, meters just read zero. A sound tech, not a
 * developer, reads this text, so it names the fault and the physical thing
 * to check, not the OSC address.
 */

import type { Aes50Bus, Aes50ChainDiscrepancy } from "@x32/domain";

/** `"AES50-A: link error — check the stage boxes"`. */
export function formatAes50LinkWarning(bus: Aes50Bus): string {
  return `AES50-${bus}: link error — check the stage boxes`;
}

/** The quieter chain-mismatch warning's headline text. */
export function formatAes50ChainWarning(): string {
  return "Stage boxes differ from configuration";
}

/** One human-readable line per discrepancy, for the chain warning's hover detail. */
export function formatAes50ChainDetail(discrepancy: Aes50ChainDiscrepancy): string {
  switch (discrepancy.kind) {
    case "box-count-mismatch":
      return `AES50-${discrepancy.bus}: ${discrepancy.actual} box(es) detected, ${discrepancy.expected} declared in installation.yaml`;
    case "input-count-mismatch":
      return `AES50-${discrepancy.bus} position ${discrepancy.position}: detected ${discrepancy.detectedModel} (${discrepancy.detectedInputs} in) but ${discrepancy.device} declares ${discrepancy.expectedInputs} in`;
  }
}
