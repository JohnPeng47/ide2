import { describe, expect, it } from "vitest";
import { createValidatedSubmission } from "./validatedSubmission";

describe("createValidatedSubmission", () => {
  it("keeps the tool active after rejection and stores only a valid resubmission", async () => {
    const submission = createValidatedSubmission<{ coordinate: number }>({
      toolName: "submit_coordinates",
      validate: ({ coordinate }) => coordinate > 10 ? "coordinate exceeds 10" : undefined,
      acceptedMessage: ({ coordinate }) => `Recorded coordinate ${coordinate}.`,
      acceptedDetails: ({ coordinate }) => ({ coordinate }),
      correctionPrompt: "Choose a coordinate within the available range."
    });
    expect(submission.promptGuideline).toContain("If it is rejected");

    const rejected = await submission.execute("first", { coordinate: 11 });
    expect(rejected).toMatchObject({
      terminate: false,
      details: { accepted: false }
    });
    expect(rejected.content[0].text).toContain("Submission rejected: coordinate exceeds 10");
    expect(rejected.content[0].text).toContain("call submit_coordinates again");
    expect(submission.value).toBeUndefined();

    const accepted = await submission.execute("second", { coordinate: 10 });
    expect(accepted).toMatchObject({
      terminate: true,
      details: { accepted: true, coordinate: 10 }
    });
    expect(submission.value).toEqual({ coordinate: 10 });
  });
});
