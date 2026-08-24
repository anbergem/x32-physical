import { describe, expect, it } from "vitest";

import { isSafeUpdateUrl } from "./updateNotice";

describe("isSafeUpdateUrl", () => {
  it("accepts an https url", () => {
    expect(isSafeUpdateUrl("https://github.com/x/y/releases/tag/v0.2.0")).toBe(true);
  });

  it("rejects a plain http url", () => {
    expect(isSafeUpdateUrl("http://github.com/x/y/releases/tag/v0.2.0")).toBe(false);
  });

  it("rejects a javascript: url", () => {
    expect(isSafeUpdateUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a data: url", () => {
    expect(isSafeUpdateUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a bare hostname", () => {
    expect(isSafeUpdateUrl("github.com")).toBe(false);
  });
});
