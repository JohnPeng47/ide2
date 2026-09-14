import { describe, expect, it } from "vitest";
import { asciiSha256 } from "../asciiSha256";

describe("asciiSha256", () => {
  it("matches the persisted SHA-256 representation", () => {
    expect(asciiSha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(asciiSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
