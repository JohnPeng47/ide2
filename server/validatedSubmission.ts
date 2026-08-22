export interface ValidatedSubmissionOptions<T> {
  toolName: string;
  validate(candidate: T): Promise<string | undefined> | string | undefined;
  acceptedMessage(candidate: T): string;
  acceptedDetails?(candidate: T): Record<string, unknown>;
  correctionPrompt?: string;
}

export function createValidatedSubmission<T>(options: ValidatedSubmissionOptions<T>) {
  let accepted: T | undefined;

  return {
    promptGuideline: `Call ${options.toolName} with the final candidate. If it is rejected, correct the reported issues and call it again.`,

    get value(): T | undefined {
      return accepted;
    },

    async execute(_toolCallId: string, candidate: T) {
      const validationError = await options.validate(candidate);
      if (validationError) {
        const correction = options.correctionPrompt
          ? `${options.correctionPrompt} Then call ${options.toolName} again.`
          : `Correct the submission and call ${options.toolName} again.`;
        return {
          content: [{
            type: "text" as const,
            text: `Submission rejected: ${validationError}. ${correction}`
          }],
          details: { accepted: false },
          terminate: false
        };
      }

      accepted = candidate;
      return {
        content: [{ type: "text" as const, text: options.acceptedMessage(candidate) }],
        details: {
          accepted: true,
          ...options.acceptedDetails?.(candidate)
        },
        terminate: true
      };
    }
  };
}
