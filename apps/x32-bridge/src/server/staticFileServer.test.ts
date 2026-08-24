/**
 * `createStaticFileHandler` served over a real `node:http` server (plan step
 * 16) — an in-process handler test wouldn't exercise the actual request
 * parsing (URL, encoded paths) an integration test does.
 */

import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStaticFileHandler, createWsOnlyHandler } from "./staticFileServer";

let root: string;
let server: Server | null = null;

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<number> {
  server = createServer(handler as RequestListener);
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function get(port: number, path: string): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.text(), headers: response.headers };
}

/**
 * Sends `rawPath` over the wire untouched — `fetch`'s `URL` parsing collapses
 * `../` segments before the request ever leaves the client, which would
 * quietly defeat the point of this test (it's testing the *server's*
 * traversal guard, not the client's URL normalisation).
 */
function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "x32-static-"));
});

afterEach(async () => {
  if (server !== null) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  await rm(root, { recursive: true, force: true });
});

describe("createStaticFileHandler", () => {
  it("serves index.html at the root with no-cache", async () => {
    await writeFile(join(root, "index.html"), "<html>app</html>");
    const port = await listen(createStaticFileHandler(root));

    const response = await get(port, "/");

    expect(response.status).toBe(200);
    expect(response.body).toBe("<html>app</html>");
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves a nested asset with a matching content type and no cache-control", async () => {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "app.js"), "console.log(1)");
    const port = await listen(createStaticFileHandler(root));

    const response = await get(port, "/assets/app.js");

    expect(response.status).toBe(200);
    expect(response.body).toBe("console.log(1)");
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("falls back to index.html for an extensionless SPA route", async () => {
    await writeFile(join(root, "index.html"), "<html>app</html>");
    const port = await listen(createStaticFileHandler(root));

    const response = await get(port, "/some/client/route");

    expect(response.status).toBe(200);
    expect(response.body).toBe("<html>app</html>");
  });

  it("404s a path with an unknown extension and no matching file", async () => {
    await writeFile(join(root, "index.html"), "<html>app</html>");
    const port = await listen(createStaticFileHandler(root));

    const response = await get(port, "/missing.js");

    expect(response.status).toBe(404);
  });

  it("blocks plain ../ traversal outside root", async () => {
    await writeFile(join(root, "index.html"), "<html>app</html>");
    const parentSecret = join(root, "..", `secret-${Date.now()}.txt`);
    await writeFile(parentSecret, "top secret");
    try {
      const port = await listen(createStaticFileHandler(root));

      // `rawGet`, not `get`: a normal `fetch`/`URL` would collapse `../`
      // client-side before the request ever leaves, which would test nothing.
      const response = await rawGet(port, `/../${parentSecret.split("/").pop()}`);

      expect(response.status).toBe(404);
      expect(response.body).not.toContain("top secret");
    } finally {
      await rm(parentSecret, { force: true });
    }
  });

  it("blocks URL-encoded ../ traversal outside root", async () => {
    await writeFile(join(root, "index.html"), "<html>app</html>");
    const parentSecret = join(root, "..", `secret-${Date.now()}.txt`);
    await writeFile(parentSecret, "top secret");
    try {
      const port = await listen(createStaticFileHandler(root));

      // A request with a file extension so the SPA index.html fallback can't
      // mask the result — this specifically exercises the traversal guard.
      const response = await rawGet(port, `/%2e%2e/${parentSecret.split("/").pop()}`);

      expect(response.status).toBe(404);
      expect(response.body).not.toContain("top secret");
    } finally {
      await rm(parentSecret, { force: true });
    }
  });

  it("serves default content types by extension", async () => {
    await writeFile(join(root, "style.css"), "body{}");
    await writeFile(join(root, "logo.svg"), "<svg></svg>");
    await writeFile(join(root, "data.json"), "{}");
    await writeFile(join(root, "favicon.ico"), "icon");
    await writeFile(join(root, "app.js.map"), "{}");
    await writeFile(join(root, "font.woff2"), "font");
    await writeFile(join(root, "archive.bin"), "bytes");
    const port = await listen(createStaticFileHandler(root));

    expect((await get(port, "/style.css")).headers.get("content-type")).toContain("text/css");
    expect((await get(port, "/logo.svg")).headers.get("content-type")).toContain("image/svg+xml");
    expect((await get(port, "/data.json")).headers.get("content-type")).toContain(
      "application/json",
    );
    expect((await get(port, "/favicon.ico")).headers.get("content-type")).toContain(
      "image/x-icon",
    );
    expect((await get(port, "/app.js.map")).headers.get("content-type")).toContain(
      "application/json",
    );
    expect((await get(port, "/font.woff2")).headers.get("content-type")).toContain("font/woff2");
    expect((await get(port, "/archive.bin")).headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  });
});

describe("createWsOnlyHandler", () => {
  it("404s any HTTP GET without touching the filesystem", async () => {
    const port = await listen(createWsOnlyHandler());

    const response = await get(port, "/");

    expect(response.status).toBe(404);
  });
});
