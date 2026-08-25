/**
 * Hand-rolled static file serving for the production release (plan step 16,
 * architecture.md §6/§7): the bridge serves the built web app over plain
 * HTTP on the same port as the WebSocket API, so a venue deployment is one
 * origin (`http://localhost:8765`). No new dependency — this is deliberately
 * small enough not to need one.
 *
 * Behaviour:
 * - Requests are resolved against `root` with path-traversal protection:
 *   `decodeURIComponent` (so an encoded `%2e%2e%2f` is caught too), then
 *   `path.join` + `path.normalize`, then a strict prefix check against
 *   `root` — anything that escapes it is a 404, never a file read attempt.
 * - Known extensions get a matching `Content-Type`; anything else gets
 *   `application/octet-stream`.
 * - Extensionless paths (`/`, `/whatever-the-SPA-router-owns`) fall back to
 *   `root/index.html` — this is a single-page app with no server-side
 *   routing.
 * - No caching headers beyond `Cache-Control: no-cache` on `index.html`
 *   itself (so a redeployed release is picked up on next load); every other
 *   file gets none at all.
 *
 * `createInstallationAwareHandler` (issue #3, architecture.md §7) wraps
 * either handler with the one dynamic route this server has,
 * `GET /api/installation` — matched by exact pathname before any of the
 * above runs, so it neither goes through nor weakens the traversal guard.
 */

import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

/**
 * Resolves `pathname` (a request URL's path, still URL-encoded) against
 * `root`. Returns `null` when decoding fails or the resolved path would land
 * outside `root` — the only two ways a request can misbehave here.
 */
function resolveWithinRoot(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const resolved = normalize(join(root, decoded));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

/** Extensionless request paths (the SPA's own routes, or `/`) fall back to `root/index.html`. */
function isExtensionless(path: string): boolean {
  return extname(path) === "";
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * Picks the file to actually serve for a resolved, in-root path: the file
 * itself if it exists; its `index.html` if it's a directory; `root/index.html`
 * as the SPA fallback if the path is extensionless and nothing else matched;
 * otherwise `null` (404).
 */
async function pickFile(resolved: string, root: string): Promise<string | null> {
  const resolvedStat = await statOrNull(resolved);
  if (resolvedStat?.isFile()) return resolved;
  if (resolvedStat?.isDirectory()) {
    const dirIndex = join(resolved, "index.html");
    if ((await statOrNull(dirIndex))?.isFile()) return dirIndex;
  }

  if (!isExtensionless(resolved)) return null;

  const rootIndex = join(root, "index.html");
  return (await statOrNull(rootIndex))?.isFile() ? rootIndex : null;
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
}

/**
 * Builds the HTTP request listener that serves `root`. Only `GET`/`HEAD` are
 * handled; anything else is a 404 (this server has no writable routes —
 * CLAUDE.md invariant 5 extends to the transport, not just the mixer).
 */
export function createStaticFileHandler(
  root: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendNotFound(res);
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://internal").pathname;
    const resolved = resolveWithinRoot(root, pathname);
    if (resolved === null) {
      sendNotFound(res);
      return;
    }

    void pickFile(resolved, root).then((filePath) => {
      if (filePath === null) {
        sendNotFound(res);
        return;
      }

      const headers: Record<string, string> = { "Content-Type": contentTypeFor(filePath) };
      if (basename(filePath) === "index.html") {
        headers["Cache-Control"] = "no-cache";
      }
      res.writeHead(200, headers);

      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    }, () => sendNotFound(res));
  };
}

/**
 * The fallback listener when no `X32_WEB_DIST` is configured (dev, or a bare
 * bridge process): the WebSocket API is unaffected, but a plain HTTP `GET`
 * gets a minimal 404 rather than any file access.
 */
export function createWsOnlyHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  return (_req, res) => {
    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("x32-bridge: WebSocket only (no X32_WEB_DIST configured)");
  };
}

/** The one route this server has beyond static files (architecture.md §7). */
const INSTALLATION_ROUTE_PATH = "/api/installation";

/**
 * Wraps `base` (`createStaticFileHandler` or `createWsOnlyHandler`) with
 * `GET`/`HEAD /api/installation` (architecture.md §7): matched *before* any
 * static resolution, so it is unaffected by — and cannot weaken —
 * `resolveWithinRoot`'s path-traversal guard above. `getInstallationText` is
 * read fresh on every request (not captured once) so a value learnt only
 * after this handler is built (there is none currently, but the loader
 * runs before this is called either way) would still be picked up.
 *
 * Serves `getInstallationText()`'s current value verbatim as `text/yaml`
 * with `Cache-Control: no-cache` when it is non-null; `null` (file missing
 * or invalid at startup, `installationFile.ts`) is a 404 — never a
 * partial or empty 200, so the web app's fallback triggers deterministically
 * (architecture.md §7 / issue #3's "Decisions already made").
 */
export function createInstallationAwareHandler(
  base: (req: IncomingMessage, res: ServerResponse) => void,
  getInstallationText: () => string | null,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method === "GET" || req.method === "HEAD") {
      const pathname = new URL(req.url ?? "/", "http://internal").pathname;
      if (pathname === INSTALLATION_ROUTE_PATH) {
        const text = getInstallationText();
        if (text === null) {
          sendNotFound(res);
          return;
        }

        res.writeHead(200, { "Content-Type": "text/yaml", "Cache-Control": "no-cache" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(text);
        return;
      }
    }

    base(req, res);
  };
}
