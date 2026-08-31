import { describe, expect, it } from "vitest";
import { resolveRepositoryReference } from "./links";

describe("resolveRepositoryReference", () => {
  it("resolves repository-relative links from the anchor document", () => {
    expect(resolveRepositoryReference("docs/guides/start.md", "../API.md#request"))
      .toBe("docs/API.md");
    expect(resolveRepositoryReference("README.md", "docs/setup.md?mode=full"))
      .toBe("docs/setup.md");
  });

  it("rejects root escapes, absolute paths, schemes, and backslashes", () => {
    expect(resolveRepositoryReference("README.md", "../outside.md")).toBeNull();
    expect(resolveRepositoryReference("README.md", "/absolute.md")).toBeNull();
    expect(resolveRepositoryReference("README.md", "javascript:alert(1)")).toBeNull();
    expect(resolveRepositoryReference("README.md", "docs\\file.md")).toBeNull();
  });
});
