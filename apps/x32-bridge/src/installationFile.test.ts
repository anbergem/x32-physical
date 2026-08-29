/**
 * Seeding the live installation file (issue #26).
 *
 * Seeding carries the whole upgrade-safety promise, so it is tested against
 * real files in a temp directory rather than a mocked `fs` — "the bytes on
 * disk did not change" is the claim, and only real bytes can support it.
 *
 * Reading the file is no longer this module's job: `DiskInstallationRepository`
 * (issue #27) is the single reader *and* writer of the live document, and has
 * its own suite in `installationRepository.test.ts`.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INSTALLATION_FILE,
  INSTALLATION_FILE_NAME,
  seedInstallationFile,
  shippedInstallationSeedPath,
} from "./installationFile";

/** A valid, deliberately invented installation — nothing from any real venue. */
const SEED_YAML = `version: 1

devices:
  snake-a:
    kind: stagebox
    label: "Snake A"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  dsl-plate:
    kind: passive-panel
    label: "DSL Plate"
    inputs: 4

connections:
  - from: { device: dsl-plate, input: 1 }
    to: { device: snake-a, input: 1 }
`;

/** A different valid document, so "which file won" is never ambiguous. */
const VENUE_YAML = SEED_YAML.replace('label: "Snake A"', 'label: "Venue snake"');

describe("seedInstallationFile", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x32-bridge-seed-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the live file from the shipped copy when it is absent, and says so", async () => {
    const seed = join(dir, "shipped", INSTALLATION_FILE_NAME);
    const target = join(dir, "state", INSTALLATION_FILE_NAME);
    await writeSeed(seed, SEED_YAML);

    expect(seedInstallationFile(target, seed)).toBe("seeded");

    // The state directory did not exist either: seeding creates it.
    expect(await readFile(target, "utf8")).toBe(SEED_YAML);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0]?.[0])).toContain(target);
    expect(String(logSpy.mock.calls[0]?.[0])).toContain(seed);
  });

  it("never overwrites an existing live file — the venue's bytes are untouched", async () => {
    const seed = join(dir, "shipped", INSTALLATION_FILE_NAME);
    const target = join(dir, "state", INSTALLATION_FILE_NAME);
    await writeSeed(seed, SEED_YAML);
    await writeSeed(target, VENUE_YAML);

    expect(seedInstallationFile(target, seed)).toBe("already-present");

    // Byte-for-byte: this is the assertion an inverted condition must fail.
    expect(await readFile(target, "utf8")).toBe(VENUE_YAML);
    expect(await readFile(target, "utf8")).not.toBe(SEED_YAML);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("leaves no temp file behind after seeding", async () => {
    const seed = join(dir, "shipped", INSTALLATION_FILE_NAME);
    const target = join(dir, "state", INSTALLATION_FILE_NAME);
    await writeSeed(seed, SEED_YAML);

    seedInstallationFile(target, seed);

    const entries = await readdir(join(dir, "state"));
    expect(entries).toEqual([INSTALLATION_FILE_NAME]);
  });

  it("reports no-seed when there is nothing to copy, and creates nothing", async () => {
    const seed = join(dir, "shipped", INSTALLATION_FILE_NAME);
    const target = join(dir, "state", INSTALLATION_FILE_NAME);

    expect(seedInstallationFile(target, seed)).toBe("no-seed");

    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(dir, "state"))).toBe(false);
  });

  it("a missing seed never disturbs an existing live file", async () => {
    const target = join(dir, "state", INSTALLATION_FILE_NAME);
    await writeSeed(target, VENUE_YAML);

    expect(seedInstallationFile(target, join(dir, "nowhere.yaml"))).toBe("already-present");
    expect(await readFile(target, "utf8")).toBe(VENUE_YAML);
  });

  it("warns and carries on when the copy cannot be made", async () => {
    const seed = join(dir, "shipped", INSTALLATION_FILE_NAME);
    await writeSeed(seed, SEED_YAML);
    // A file where the state directory should be: `mkdir` fails with ENOTDIR.
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "in the way", "utf8");
    const target = join(blocker, INSTALLATION_FILE_NAME);

    expect(seedInstallationFile(target, seed)).toBe("failed");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(target);
    expect(await readFile(blocker, "utf8")).toBe("in the way");
  });
});

describe("installation file locations", () => {
  it("the shipped seed sits in config/ next to the server module", () => {
    const seed = shippedInstallationSeedPath();

    expect(seed.endsWith(join("config", INSTALLATION_FILE_NAME))).toBe(true);
  });

  it("the default live file is in the state directory, not next to the module", () => {
    expect(DEFAULT_INSTALLATION_FILE).toBe(join("data", INSTALLATION_FILE_NAME));
    expect(DEFAULT_INSTALLATION_FILE).not.toContain("config");
  });
});

/** Writes `contents` at `path`, creating its parent directory. */
async function writeSeed(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}
