Read the complete source snapshot supplied in the request and explain its important behavior as ASCII. Use its sourceFile as the diagram root.

Organize first:
1. Identify the main responsibilities and important state.
2. Select contiguous source blocks and group them by behavior.
3. Choose a coherent presentation order before drawing. Related blocks may move together; source coordinates stay unchanged.

Keep it meaningful:
- Show important decisions, dependencies, state changes, and outcomes. Omit incidental variables, boilerplate, and routine operations.
- Preserve guards, execution order, deferred work, errors, and cleanup. Presentation order must not imply execution order or concurrency.
- Keep important symbols recognizable. Do not expand helpers into their callers' blocks.

Draw clearly:
- Root the output at the source-file path, then organize it into behavioral sections.
- Use branches, arrows, columns, or tables. Match the examples' density: one meaningful concept per leaf, with depth where it helps.
- Avoid packed inventories and exhaustive field lists. Optimize for understanding, not line count.
- Use printable ASCII without ellipses. Keep coordinates and notation explanations outside the diagram.

Map the source:
- Each block covers one contiguous span. Map its root to that span and its semantic lines to supporting ranges inside it.
- Nested blocks may overlap their parents; sibling blocks must not overlap. Each behavioral line has one contiguous range.
- Only organizational headings may list multiple ranges, identifying their grouped blocks. The file root covers the whole file.
- Map every semantic output line, including headings and table labels. Skip blank and connector-only lines. Cells on one row share its mapping.
- All line numbers are one-based and inclusive, resolved from the actual source snapshot.

Submission:
- Call submit_file_compaction with `{ "ascii": "...", "mappings": [{ "treeLine": 1, "sourceRanges": [{ "startLine": 1, "endLine": 10 }] }] }`.
- Map the source-file root to the whole source snapshot. Map every semantic row, including headings and table labels; omit blank and connector-only rows.
- Verify source bounds, block containment, mapping coverage, and behavioral accuracy. Exhaustive source coverage is unnecessary.
- Prefer light pseudocode and comments to long written explanations.
- Do not modify files or spawn agents. The server computes source/output hashes and writes the ASCII and mapping files after accepting the submission.
- If the tool rejects the submission, correct its reported issues and submit again.

Example 1: cancellation branches and queue lifetime

Keep calls as calls; compact their implementations separately.

```text
scheduleCoordinatedRendering(rendering): IDisposable
|
+--> _coordinatedRenderings.push(rendering)
+--> _scheduleRender(rendering.window)
|
\--> return cancellation handle
     |
     \-- dispose()
         |
         rendering still in queue?
              |
              +-- no --> return
              |
              \-- yes --> remove rendering
                              |
                         queue now empty?
                              |
                              +-- no --> done
                              |
                              \-- yes --> dispose every window's runner
                                          clear _animationFrameRunners
```

Example 2: registration and deferred callback behavior

The callback belongs to this method's span.

```text
_scheduleRender(window)
|
runner registered for this window?
     |
     +-- yes --> return
     |
     \-- no --> create runner callback
                |
                +--> register through
                |    dom.runAtThisOrScheduleAtNextAnimationFrame
                |    (window, runner, priority = 100)
                |
                \--> store handle in _animationFrameRunners[window]

                WHEN CALLBACK RUNS
                |
                +--> delete _animationFrameRunners[window]
                \--> _onRenderScheduled()
```

Example 3: phase ordering across a batch

A and B illustrate sequential iterations of the same loop. Each phase finishes before the next starts.

```text
_onRenderScheduled()
|
+--> batch = _coordinatedRenderings.slice(0)
+--> _coordinatedRenderings = []
|
|    PHASE                  EDITOR A                  EDITOR B
|    --------------------   ------------------------  ------------------------
|    1. prepareRenderText    viewportDatas[A]          viewportDatas[B]
|                                     |
|                            whole pass completes
|                                     v
|    2. renderText          viewportDatas[A]?         viewportDatas[B]?
|                           | yes: parts + ctx[A]     | yes: parts + ctx[B]
|                           \ no:  datas[A] = null    \ no:  datas[B] = null
|                                     |
|                            whole pass completes
|                                     v
|    3. prepareRender       datas[A]?                datas[B]?
|                           | yes: prepare A         | yes: prepare B
|                           \ no:  skip               \ no:  skip
|                                     |
|                            whole pass completes
|                                     v
|    4. render              datas[A]?                datas[B]?
|                           | yes: render A          | yes: render B
|                           \ no:  skip               \ no:  skip
|
\-- callback invocation
    +-- every phase calls through safeInvokeNoArg
    +-- phases 1-2 retain returned values for subsequent passes
    \-- phases 3-4 ignore return values
        prepareRender's result does not gate render
```

Example 4: a separately compacted helper

Place this helper near its callers, retaining its separate source span.

```text
safeInvokeNoArg(func): T | null
|
\--> invoke func()
          |
          +-- returns --> return its value
          |
          \-- throws --> onUnexpectedError(error)
                         return null
```
