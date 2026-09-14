import { describe, expect, it } from "vitest";
import { builtInDomainProfile } from "../domainProfiles";

describe("built-in domain profiles", () => {
  it("adapts persisted CodeEntity evidence without changing its anchors", () => {
    const anchors = [{ path: "interview.txt", startLine: 4, endLine: 5 }];
    const evidence = builtInDomainProfile("document").evidenceSchema.fromCodeEntity({
      id: "entity-claim",
      handle: "claim",
      label: "Claim",
      category: "state",
      summary: "A grounded claim.",
      sourceRanges: anchors
    });

    expect(evidence).toEqual({
      id: "entity-claim",
      handle: "claim",
      label: "Claim",
      kind: "state",
      summary: "A grounded claim.",
      anchors
    });
  });
});
