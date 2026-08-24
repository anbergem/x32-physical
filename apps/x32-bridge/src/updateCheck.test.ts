/**
 * `updateCheck.ts` tests (docs/plan.md step 20). No real network, no real
 * timers — a fake `fetch` and Vitest's fake timers stand in for both, so
 * these run instantly and offline.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkForUpdate,
  isNewerVersion,
  readLocalVersion,
  resolveUpdateRepo,
  startUpdateChecker,
} from "./updateCheck";

describe("isNewerVersion", () => {
  it.each([
    ["0.1.0", "0.2.0", true],
    ["0.2.0", "0.1.0", false],
    ["0.1.0", "0.1.0", false],
    ["1.0.0 (abc123)", "1.1.0", true],
    ["0.9.0", "0.10.0", true], // numeric, not lexicographic
    ["not-a-version", "0.2.0", false],
    ["0.1.0", "not-a-version", false],
    ["garbage", "garbage", false],
    ["0.1.0", "v0.2.0", true], // leading "v" tolerated
  ])("isNewerVersion(%j, %j) -> %j", (local, remote, expected) => {
    expect(isNewerVersion(local, remote)).toBe(expected);
  });
});

describe("readLocalVersion", () => {
  it("returns null for an undefined path", () => {
    expect(readLocalVersion(undefined)).toBeNull();
  });

  it("returns null for a missing file", () => {
    expect(readLocalVersion("/does/not/exist/VERSION")).toBeNull();
  });
});

describe("resolveUpdateRepo", () => {
  it("defaults to the public repo", () => {
    expect(resolveUpdateRepo({})).toBe("anbergem/x32-physical");
  });

  it("X32_UPDATE_CHECK=0 disables regardless of X32_UPDATE_REPO", () => {
    expect(
      resolveUpdateRepo({ X32_UPDATE_CHECK: "0", X32_UPDATE_REPO: "someone/else" }),
    ).toBeNull();
  });

  it("X32_UPDATE_REPO=\"\" disables checking", () => {
    expect(resolveUpdateRepo({ X32_UPDATE_REPO: "" })).toBeNull();
  });

  it("a set X32_UPDATE_REPO overrides the default", () => {
    expect(resolveUpdateRepo({ X32_UPDATE_REPO: "someone/else" })).toBe("someone/else");
  });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("checkForUpdate", () => {
  it("reports a strictly newer release", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v0.2.0", html_url: "https://github.com/x/y/releases/tag/v0.2.0" }),
    );

    const result = await checkForUpdate({ localVersion: "0.1.0", repo: "x/y", fetchImpl });

    expect(result).toEqual({ version: "0.2.0", url: "https://github.com/x/y/releases/tag/v0.2.0" });
  });

  it("returns null for the same version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v0.1.0", html_url: "https://github.com/x/y/releases/tag/v0.1.0" }),
    );
    expect(await checkForUpdate({ localVersion: "0.1.0", repo: "x/y", fetchImpl })).toBeNull();
  });

  it("returns null for an older release", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v0.0.9", html_url: "https://github.com/x/y/releases/tag/v0.0.9" }),
    );
    expect(await checkForUpdate({ localVersion: "0.1.0", repo: "x/y", fetchImpl })).toBeNull();
  });

  it("returns null (no throw) on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 404));
    const onError = vi.fn();
    await expect(
      checkForUpdate({ localVersion: "0.1.0", repo: "x/y", fetchImpl, onError }),
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("returns null (no throw) on a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const onError = vi.fn();
    await expect(
      checkForUpdate({ localVersion: "0.1.0", repo: "x/y", fetchImpl, onError }),
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("returns null when the local version is unknown", async () => {
    const fetchImpl = vi.fn();
    expect(await checkForUpdate({ localVersion: null, repo: "x/y", fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when checking is disabled (repo null)", async () => {
    const fetchImpl = vi.fn();
    expect(await checkForUpdate({ localVersion: "0.1.0", repo: null, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-https release url without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v0.2.0", html_url: "http://github.com/x/y/releases/tag/v0.2.0" }),
    );
    expect(await checkForUpdate({ localVersion: "0.1.0", repo: "x/y", fetchImpl })).toBeNull();
  });

  it("honours the timeout via AbortSignal", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const onError = vi.fn();

      const promise = checkForUpdate({
        localVersion: "0.1.0",
        repo: "x/y",
        fetchImpl,
        timeoutMs: 1000,
        onError,
      });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toBeNull();
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startUpdateChecker", () => {
  let versionFile: string;
  let workDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    workDir = await mkdtemp(join(tmpdir(), "x32-update-check-"));
    versionFile = join(workDir, "VERSION");
    await writeFile(versionFile, "0.1.0+abc1234\n");
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(workDir, { recursive: true, force: true });
  });

  it("never calls fetch when disabled via env", async () => {
    const fetchImpl = vi.fn();
    const checker = startUpdateChecker({
      versionFilePath: versionFile,
      env: { X32_UPDATE_CHECK: "0" },
      fetchImpl,
      delayMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(checker.getUpdate()).toBeNull();
    checker.stop();
  });

  it("never calls fetch when the version file is absent", async () => {
    const fetchImpl = vi.fn();
    const checker = startUpdateChecker({
      versionFilePath: join(workDir, "does-not-exist"),
      fetchImpl,
      delayMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).not.toHaveBeenCalled();
    checker.stop();
  });

  it("runs once after delayMs, reports a newer version, and notifies subscribers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v0.2.0", html_url: "https://github.com/x/y/releases/tag/v0.2.0" }),
    );
    const listener = vi.fn();

    const checker = startUpdateChecker({
      versionFilePath: versionFile,
      env: { X32_UPDATE_REPO: "x/y" },
      fetchImpl,
      delayMs: 30_000,
      intervalMs: 6 * 60 * 60 * 1000,
    });
    checker.subscribe(listener);

    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(checker.getUpdate()).toEqual({
      version: "0.2.0",
      url: "https://github.com/x/y/releases/tag/v0.2.0",
    });
    expect(listener).toHaveBeenCalledOnce();
    checker.stop();
  });

  it("checks again after intervalMs, not before", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v0.1.0", html_url: "https://github.com/x/y/releases/tag/v0.1.0" }),
    );

    const checker = startUpdateChecker({
      versionFilePath: versionFile,
      env: { X32_UPDATE_REPO: "x/y" },
      fetchImpl,
      delayMs: 1000,
      intervalMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchImpl).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    checker.stop();
  });

  it("stop() prevents any further scheduled check", async () => {
    const fetchImpl = vi.fn();
    const checker = startUpdateChecker({
      versionFilePath: versionFile,
      fetchImpl,
      delayMs: 10,
      intervalMs: 10,
    });
    checker.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
