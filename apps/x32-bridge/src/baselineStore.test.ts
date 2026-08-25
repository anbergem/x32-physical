/**
 * `DiskBaselineStore` (architecture.md §7): round-trip, missing-file, and
 * corrupt-file tolerance, plus the temp-file+rename write path leaving no
 * stray temp files behind.
 */

import { mixerChannelId } from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiskBaselineStore } from "./baselineStore";

function snapshot(): MixerSnapshot {
  return {
    channels: [
      {
        channel: mixerChannelId(1),
        name: "Kick",
        source: { kind: "aes50", bus: "A", channel: 1 },
      },
    ],
    selectedChannel: null,
    aes50LinkState: null,
    aes50Chain: [],
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "x32-baseline-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DiskBaselineStore", () => {
  it("returns null when no file exists yet", async () => {
    const store = new DiskBaselineStore(join(dir, "baseline.json"));
    await expect(store.load()).resolves.toBeNull();
  });

  it("round-trips a saved snapshot", async () => {
    const filePath = join(dir, "nested", "baseline.json");
    const store = new DiskBaselineStore(filePath);

    await store.save(snapshot());

    const loaded = await store.load();
    expect(loaded).toEqual(snapshot());

    const onDisk: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(onDisk).toEqual(snapshot());
  });

  it("creates the containing directory on save", async () => {
    const filePath = join(dir, "a", "b", "c", "baseline.json");
    const store = new DiskBaselineStore(filePath);

    await store.save(snapshot());

    await expect(readFile(filePath, "utf8")).resolves.toContain("Kick");
  });

  it("writes via temp-file + rename, leaving no stray temp file", async () => {
    const filePath = join(dir, "baseline.json");
    const store = new DiskBaselineStore(filePath);

    await store.save(snapshot());

    const entries = await readdir(dir);
    expect(entries).toEqual(["baseline.json"]);
  });

  it("tolerates a corrupt (non-JSON) file: no baseline, no throw", async () => {
    const filePath = join(dir, "baseline.json");
    await writeFile(filePath, "{ not valid json", "utf8");
    const store = new DiskBaselineStore(filePath);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(store.load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tolerates a well-formed-JSON but malformed-shape file: no baseline, no throw", async () => {
    const filePath = join(dir, "baseline.json");
    await writeFile(filePath, JSON.stringify({ channels: "nope" }), "utf8");
    const store = new DiskBaselineStore(filePath);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(store.load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
