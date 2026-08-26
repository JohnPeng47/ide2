# CodeEntity Source-Range Exclusivity Proposal

## Goal

Prevent a newly collected CodeEntity set from assigning the same source line to
more than one submitted source range. The collection prompt should state this
constraint, and `submit_code_entities` should reject a conflicting candidate so
the same agent can correct and resubmit it.

This is a collection-time invariant. Existing finalized collections and
imported dependencies remain readable and are not migrated.

## Invariant

Within one `submit_code_entities` candidate, source ranges that resolve to the
same repository file must be pairwise disjoint.

For inclusive ranges `a` and `b`, they conflict when:

```text
a.startLine <= b.endLine && b.startLine <= a.endLine
```

Consequences:

- Exact duplicates conflict.
- Partial overlaps and containment conflict.
- Sharing one boundary line conflicts: `10-20` and `20-30` are invalid.
- Adjacent ranges are valid: `10-20` and `21-30` do not overlap.
- Equal line numbers in different files are valid.
- The rule applies across the entire candidate, including two redundant ranges
  within one CodeEntity. A source line therefore has one range owner in a
  collected set.

File identity should use the canonical path already produced by `realpath`, not
the submitted path string. This catches aliases such as `src/a.ts`,
`./src/a.ts`, or two in-repository symlinks that resolve to the same file.

## Prompt Change

Add a short, fixed source-range ownership rule to the collection context built
by `codeEntityCollectionPrompt` in `server/codeEntityPrompt.ts`, immediately
after the request for exact repo-relative source ranges:

```text
Source-range ownership is exclusive across the submitted CodeEntity set. Two
source ranges that resolve to the same file must not share a line. Adjacent
ranges are allowed; merge duplicate concepts or split their ranges before
submission.
```

This belongs in the fixed collection contract rather than only in
`DEFAULT_CODE_ENTITY_IDENTIFICATION_CRITERIA`:

- validation applies to every submission, including custom prompt profiles;
- existing workspaces persist their built-in criteria, so changing only the
  built-in constant would not update them; and
- a user-editable criterion should not be able to remove a server invariant.

Because the composed context changes, emit new prompt configs with
`contextPrompt.templateVersion: 2`. Continue accepting stored version-1 prompt
configs by widening the record type to `1 | 2`; the rendered prompt snapshot
remains the source of truth for historical runs. No prompt-template migration
or automatic overwrite of user-edited built-ins is needed.

## Validation and Agent Correction

Extract a small source-range conflict detector, for example in
`server/codeEntityRanges.ts`. Each input entry should carry:

```ts
{
  canonicalPath: string;
  displayPath: string;
  startLine: number;
  endLine: number;
  entityHandle: string;
  entityIndex: number;
  rangeIndex: number;
}
```

Group by `canonicalPath`, sort each group deterministically by start line, end
line, entity index, and range index, then compare intervals. The submitted
limits are small (at most 200 entities with 12 ranges each), so either a sorted
scan or a direct pairwise check is sufficient; a sorted scan makes ordering and
error selection deterministic.

Integrate the detector in two places:

1. In `validateSubmittedSourceRanges` in `server/agentRuntime.ts`, collect the
   canonical file identity while performing the existing structural,
   repository-boundary, file, and EOF checks. Run overlap detection only after
   every range is otherwise valid.
2. In `DiagramApplication.validateEntityDrafts`, run the same detector over the
   normalized ranges before returning records. This is defense in depth for
   alternate/mock `DiagramAgentRuntime` implementations that bypass the Pi
   submission tool. It should inspect the clipped ranges that would actually be
   persisted, preserving the application's current EOF-clipping behavior.

The submission-tool path is what provides regeneration. It already uses
`createValidatedSubmission`, whose rejected result has `terminate: false` and
leaves the accepted value unset. Return an actionable error such as:

```text
source ranges overlap in src/worker.ts: @entity/queue range 40-58 and
@entity/dispatch range 55-72 share lines 55-58; each source line may belong to
only one submitted CodeEntity
```

Update the collector's correction prompt from the coordinate-only wording to:

```text
Inspect the reported files, resolve source-range conflicts by merging duplicate
concepts or splitting their ranges, verify all coordinates, and submit the full
CodeEntity set again.
```

The agent then calls `submit_code_entities` again in the same session. A valid
resubmission terminates normally; if the agent exits without one, the existing
`collector finished without submitting code entities` failure behavior remains.
This needs no new retry loop, run kind, or persistence state.

## Test Plan

Add focused unit coverage for the extracted detector:

- exact duplicate ranges in one canonical file are rejected;
- partial overlap, full containment, and a shared boundary line are rejected;
- adjacent ranges are accepted;
- equal ranges in different canonical files are accepted;
- different submitted paths resolving to the same canonical file are rejected;
- overlap within one entity is rejected as redundant;
- the reported conflict is deterministic and names both entity handles, both
  ranges, the display path, and the shared line span.

Extend `server/codeEntityPrompt.test.ts` to assert that the rendered collection
prompt contains the exclusivity rule and uses context template version 2.

Add an application test using the fake runtime to verify that overlapping
drafts cannot be finalized even when the runtime bypasses tool validation. Keep
the existing EOF-clipping test as a regression check, and add a case confirming
that application-level overlap comparison uses the clipped persisted ranges.

`server/validatedSubmission.test.ts` already proves that rejection keeps a
submission tool active and accepts a corrected second call. It does not need to
duplicate range semantics; an optional integration-style test can wire the new
validator into that helper and assert that the overlap message is returned on
the first call.

## Acceptance Criteria

- Every newly rendered CodeEntity collection prompt explicitly prohibits
  same-file shared source lines and explains that adjacent ranges are allowed.
- A candidate containing an exact or partial same-file overlap is rejected by
  `submit_code_entities` without terminating the agent session.
- The rejection identifies both conflicting entities and coordinates well
  enough for the agent to regenerate the full candidate.
- A corrected, non-overlapping resubmission is accepted in the same session.
- Alternate collection runtimes cannot persist overlapping ranges through the
  application layer.
- Existing finalized/imported CodeEntities remain loadable without migration.
- No domain schema version, UI, API, or storage-layout change is required beyond
  recognizing context prompt template versions 1 and 2.

## Out of Scope

- Automatically merging or truncating conflicting entity ranges. That could
  silently change entity meaning and should remain the collecting agent's job.
- Rejecting or rewriting historical collections and imported artifact bundles.
- Prohibiting multiple non-overlapping ranges from the same file on one entity.
- Changing compacted-section or collapsed-node overlap rules inside a single
  source range; those are separate presentation validations.
