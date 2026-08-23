import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "./index";

// Placeholder so the test pipeline is exercised from step 1 onwards.
// Replaced by the topology model tests in plan step 2.
describe("@x32/domain", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@x32/domain");
  });
});
