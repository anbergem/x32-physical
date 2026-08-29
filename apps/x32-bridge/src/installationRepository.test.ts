/**
 * `DiskInstallationRepository` (issue #27): the only thing in the app that
 * writes the venue's `installation.yaml`. Atomicity and the `.bak` are the
 * two properties worth asserting on real files in a real temp directory —
 * a mocked `fs` would prove nothing about either.
 */

import { installationVersion } from "@x32/installation";
import { InstallationVersionConflictError } from "@x32/installation";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backupPathFor, DiskInstallationRepository } from "./installationRepository";

const VALID_YAML = `version: 1

devices:
  # Kept so a mangled write is visible in the assertions below.
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  front-left:
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections:
  - from: { device: front-left, input: 1 }
    to: { device: stagebox-1, input: 1 }
`;

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "x32-installation-repo-"));
  path = join(dir, "installation.yaml");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("read", () => {
  it("returns the exact bytes, a content-hash version, and the parsed installation", async () => {
    await writeFile(path, VALID_YAML, "utf8");

    const state = await new DiskInstallationRepository(path).read();

    expect(state.text).toBe(VALID_YAML);
    expect(state.version).toBe(installationVersion(VALID_YAML));
    expect(state.installation?.devices.map((device) => device.id)).toEqual([
      "stagebox-1",
      "front-left",
    ]);
    expect(state.error).toBeNull();
  });

  it("reports an unparseable document as a value, keeping the bytes readable", async () => {
    await writeFile(path, "not: [valid, installation, shape", "utf8");

    const state = await new DiskInstallationRepository(path).read();

    expect(state.installation).toBeNull();
    expect(state.error).toContain(path);
    expect(state.text).toBe("not: [valid, installation, shape");
  });

  it("throws, naming the file, when it cannot be read at all", async () => {
    const repository = new DiskInstallationRepository(join(dir, "absent.yaml"));

    await expect(repository.read()).rejects.toThrow(/Cannot read installation file .*absent\.yaml/);
  });
});

describe("write", () => {
  it("replaces the file and leaves the previous content in a .bak", async () => {
    await writeFile(path, VALID_YAML, "utf8");
    const repository = new DiskInstallationRepository(path);
    const { version } = await repository.read();
    const next = VALID_YAML.replace('"Stagebox 1"', '"Stagebox One"');

    const state = await repository.write(next, version);

    expect(await readFile(path, "utf8")).toBe(next);
    expect(await readFile(backupPathFor(path), "utf8")).toBe(VALID_YAML);
    expect(state.version).toBe(installationVersion(next));
    expect(state.installation?.devices[0]?.label).toBe("Stagebox One");
  });

  it("leaves no temp files behind — the swap is a rename, not a partial file", async () => {
    await writeFile(path, VALID_YAML, "utf8");
    const repository = new DiskInstallationRepository(path);
    const { version } = await repository.read();

    await repository.write(`${VALID_YAML}\n# appended\n`, version);

    const entries = await readdir(dir);
    expect(entries.filter((entry) => entry.includes(".tmp"))).toEqual([]);
    expect(entries.sort()).toEqual(["installation.yaml", "installation.yaml.bak"]);
  });

  it("rejects a stale expectedVersion and leaves the file byte-for-byte alone", async () => {
    await writeFile(path, VALID_YAML, "utf8");
    const repository = new DiskInstallationRepository(path);

    await expect(repository.write("version: 1\n", "0000000000000000")).rejects.toBeInstanceOf(
      InstallationVersionConflictError,
    );

    expect(await readFile(path, "utf8")).toBe(VALID_YAML);
    expect(existsSync(backupPathFor(path))).toBe(false);
  });

  it("rejects when the file changed on disk since it was read", async () => {
    await writeFile(path, VALID_YAML, "utf8");
    const repository = new DiskInstallationRepository(path);
    const { version } = await repository.read();

    // Somebody edits the file in Notepad in the meantime.
    await writeFile(path, `${VALID_YAML}\n# edited by hand\n`, "utf8");

    await expect(repository.write("version: 1\n", version)).rejects.toBeInstanceOf(
      InstallationVersionConflictError,
    );
    expect(await readFile(path, "utf8")).toContain("# edited by hand");
  });
});
