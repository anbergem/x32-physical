/**
 * In-app update notice (docs/plan.md step 20, architecture.md §7). This is a
 * convenience banner, not an update system: the bridge only *checks* GitHub
 * Releases and reports what it found over the existing protocol path — no
 * download, no self-replace, ever. The tech downloads and double-clicks the
 * new MSI by hand.
 *
 * `readLocalVersion` reads the staged `VERSION` file from a path resolved
 * relative to this module's own `import.meta.url` — after
 * `scripts/release-build.mjs` bundles the bridge into `server.mjs`, that file
 * and `VERSION` sit side by side in the release directory.
 *
 * `VERSION` holds `<release version>+<git short hash>` for a real release —
 * the release tag the workflow passes to `release:build --version`, the same
 * value the MSI's `ProductVersion` is built from. A local `pnpm release:build`
 * with no `--version` stages `dev+<git short hash>` instead, which carries no
 * `x.y.z` for `parseVersionTriple` to find, so `checkForUpdate` returns `null`
 * and an unversioned build never advertises an update. In dev (`tsx` running
 * this file straight out of `src/`) there is no `VERSION` file at all, so the
 * local version is `null` and checking is silently disabled the same way — no
 * noise, matching the "no internet at the venue" failure mode.
 *
 * That "no triple means disabled" property is load-bearing, not incidental.
 * `VERSION` used to be stamped from the root `package.json` version, which is
 * permanently `0.0.0`, so every installed build read as older than every
 * published release and permanently offered an update to the release it was
 * already running (issue #30). The fallback must therefore never be a
 * parseable version.
 *
 * `X32_UPDATE_REPO` (default `anbergem/x32-physical`) selects the GitHub
 * repo; set it to `""`, or set `X32_UPDATE_CHECK=0`, to disable checking
 * entirely. `startUpdateChecker` runs the first check ~30s after startup (so
 * it never slows boot) and then at most every 6 hours, holding the result in
 * memory as `{ version, url } | null`. Every failure — offline venue, DNS,
 * rate limit, malformed payload — is swallowed; each check attempt logs at
 * most once, since checks never overlap.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";

export interface UpdateInfo {
  readonly version: string;
  readonly url: string;
}

const DEFAULT_REPO = "anbergem/x32-physical";
const DEFAULT_DELAY_MS = 30_000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;

/** `VERSION`, resolved next to this module — see the module doc comment. */
export function defaultVersionFilePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "VERSION");
}

/**
 * Reads and trims the staged `VERSION` file. `undefined`/missing/unreadable
 * all mean "unknown" — the caller disables checking rather than throwing.
 */
export function readLocalVersion(versionFilePath: string | undefined): string | null {
  if (versionFilePath === undefined) return null;
  try {
    return readFileSync(versionFilePath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * `X32_UPDATE_REPO` wins when set (including `""`, which disables checking);
 * `X32_UPDATE_CHECK=0` disables it outright regardless of the repo. Otherwise
 * the public default repo.
 */
export function resolveUpdateRepo(env: NodeJS.ProcessEnv): string | null {
  if (env.X32_UPDATE_CHECK === "0") return null;

  const raw = env.X32_UPDATE_REPO;
  if (raw !== undefined) return raw.trim() === "" ? null : raw.trim();
  return DEFAULT_REPO;
}

/** Extracts a `major.minor.patch` triple from anywhere in `raw`; `null` if none is found. */
function parseVersionTriple(raw: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Numeric (never lexicographic) comparison of two version-ish strings — each
 * is scanned for its leading `X.Y.Z` triple, so both the local `VERSION`
 * file's `0.1.0+abc1234` form and a bare release tag like `0.2.0` (or
 * `v0.2.0`) parse the same way. Malformed input on either side, or an equal
 * / older remote, all resolve to `false` — this never throws.
 */
export function isNewerVersion(local: string, remote: string): boolean {
  const localTriple = parseVersionTriple(local);
  const remoteTriple = parseVersionTriple(remote);
  if (localTriple === null || remoteTriple === null) return false;

  for (let i = 0; i < 3; i += 1) {
    const remotePart = remoteTriple[i] ?? 0;
    const localPart = localTriple[i] ?? 0;
    if (remotePart > localPart) return true;
    if (remotePart < localPart) return false;
  }
  return false;
}

interface LatestRelease {
  readonly tag: string;
  readonly url: string;
}

/**
 * Fetches and validates `GET /repos/<repo>/releases/latest`. Throws on any
 * failure (network, timeout, non-2xx, malformed body) — `checkForUpdate`
 * below is the only caller, and it turns every throw into a silent `null`
 * plus at most one log line.
 */
async function fetchLatestRelease(
  repo: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<LatestRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "x32-routing-visualizer-update-check",
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub API responded ${response.status}`);
    }

    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof body.tag_name !== "string" || typeof body.html_url !== "string") {
      throw new Error("malformed GitHub release payload");
    }
    return { tag: body.tag_name, url: body.html_url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One check attempt: `null` whenever there is nothing to report — checking
 * disabled, unknown local version, a fetch failure (`onError` is called
 * first so the caller can log it), a non-https release URL (rejected outright
 * so a compromised/unexpected payload can never surface a `javascript:`/
 * `data:` link in the UI), or a remote version that is not strictly newer.
 * Never throws.
 */
export async function checkForUpdate(options: {
  localVersion: string | null;
  repo: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onError?: (message: string) => void;
}): Promise<UpdateInfo | null> {
  const {
    localVersion,
    repo,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onError,
  } = options;
  if (localVersion === null || repo === null) return null;

  let release: LatestRelease;
  try {
    release = await fetchLatestRelease(repo, fetchImpl, timeoutMs);
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error));
    return null;
  }

  if (!release.url.startsWith("https://")) return null;

  const remoteVersion = release.tag.replace(/^v/i, "");
  if (!isNewerVersion(localVersion, remoteVersion)) return null;

  return { version: remoteVersion, url: release.url };
}

export interface UpdateChecker {
  /** The most recently found update, or `null` before any is found / when disabled. */
  getUpdate(): UpdateInfo | null;
  /** Notified once per newly-found update (never re-fired for the same version). */
  subscribe(listener: (update: UpdateInfo) => void): () => void;
  /** Cancels any pending/future check. Idempotent. */
  stop(): void;
}

/**
 * Starts the periodic checker described in the module doc comment. Scheduling
 * uses a `setTimeout` chain (never `setInterval`) so checks never overlap —
 * which is also what makes "log at most once per interval" trivial: each
 * interval runs exactly one check, so logging on that one attempt's failure
 * is already the bound.
 *
 * Does nothing (no timer, no fetch, ever) when checking is disabled or the
 * local version is unknown — both are resolved once up front, not re-checked
 * per tick.
 */
export function startUpdateChecker(options: {
  versionFilePath?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  intervalMs?: number;
  timeoutMs?: number;
}): UpdateChecker {
  const {
    versionFilePath = defaultVersionFilePath(),
    env = process.env,
    fetchImpl = fetch,
    delayMs = DEFAULT_DELAY_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const repo = resolveUpdateRepo(env);
  const localVersion = readLocalVersion(versionFilePath);

  let current: UpdateInfo | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(update: UpdateInfo) => void>();

  async function runAndReschedule(): Promise<void> {
    if (stopped) return;

    const result = await checkForUpdate({
      localVersion,
      repo,
      fetchImpl,
      timeoutMs,
      onError: (message) =>
        console.warn(
          `x32-bridge: update check failed, will retry silently in ~${Math.round(intervalMs / 3_600_000)}h: ${message}`,
        ),
    });

    if (stopped) return;
    if (result !== null && result.version !== current?.version) {
      current = result;
      console.log(`x32-bridge: update available: v${result.version} (${result.url})`);
      for (const listener of listeners) listener(result);
    }

    if (!stopped) {
      timer = setTimeout(() => void runAndReschedule(), intervalMs);
    }
  }

  if (repo !== null && localVersion !== null) {
    timer = setTimeout(() => void runAndReschedule(), delayMs);
  }

  return {
    getUpdate: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
