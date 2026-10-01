# App benchmarks

Each folder is an experiment built into the **real production app**. Its `build.mjs`
selects an app baseline, maps replacement source files to app paths, and lists
integration scripts. The runner builds and tests baseline and candidate sequentially.

```sh
npm run benchmark -- code-panes-render
npm run benchmark -- code-panes-render --trials 1 --profile
npm run benchmark -- code-panes-render --ref <commit-sha>
npm run benchmark -- code-panes-render --candidate-first
npm run benchmark -- code-panes-render --build-only --keep-builds
npm run test:benchmarks
```

Requirements: Node 22+, npm, Git, `tar`, and Chrome/Chromium. Set `CHROME_PATH` if
the browser is not in a standard location or the local Playwright Chromium cache.
The CDP browser helper lives in this repository; no personal skill installation is
needed. `npm ci` installs each variant's locked dependencies independently using
npm's ordinary download cache.

## An experiment

```text
benchmarks/code-panes-render/
  build.mjs
  src/SourceCodeView.tsx
  fixtures/workspace.json
  fixtures/source.mjs
  tests/correctness.mjs
  tests/performance.mjs
  tests/session.mjs
```

`src/` contains full replacement files. Keep their relative imports as they would
appear at the destination inside the app. For example:

```js
export default {
  baseRef: 'working-tree',
  replacements: {
    'src/shared/source/SourceCodeView.tsx': './src/SourceCodeView.tsx',
  },
  build: ['npm', 'run', 'build', '--', '--sourcemap'],
  tests: ['./tests/correctness.mjs', './tests/performance.mjs'],
  parameters: { paneCounts: [1, 3, 5], trials: 3, steps: 60, width: 2400, height: 1500 },
};
```

Replacement destinations are relative to the app root; source paths and test paths
are relative to `build.mjs`. Replacements may add files as well as replace them.
There is no implicit deletion or merge operation. The ordinary app build typechecks
the replacements at their actual import locations. A benchmark must remain
compatible with the app revision it targets; it does not automatically port old APIs.

The first `SourceCodeView.tsx` is an unchanged copy of the implementation at setup
time. Edit it to try a rendering strategy. It is deliberately independent afterward:
mainline changes do not silently update the experiment. Candidate/baseline file hashes
in the manifest reveal whether they are identical or have drifted.

## Inputs and Git refs

- `working-tree` freezes tracked files plus nonignored untracked files, incorporating
  edits and deletions. It does not require a commit. Avoid editing during snapshot
  capture if you need a logically atomic repository state.
- A Git ref is resolved to a commit and exported with `git archive`. Uncommitted app
  changes are excluded. Pin a SHA in `build.mjs` for a long-lived experiment, or use
  `--ref` to override it for one run.
- The benchmark definition, replacement files, runner helpers, tests and fixtures
  come from the current benchmark directory and are frozen separately, even when
  the app baseline is an older commit.
- Working-tree snapshots omit `.git`, `node_modules`, `dist`, `coverage`, `artifacts`,
  and `benchmarks/.runs`. This is an app-source snapshot, not a backup of ignored
  files. Submodules need explicit support. Inputs with external symlinks are rejected.

The runner uses disposable source exports, so no additional branches or registered
Git worktrees are needed. Both builds start from the same captured app source.
All replacements happen inside the candidate export. App inputs are archived as
`app-source.tar.gz`; the manifest contains the commit, file hashes, lockfile hash,
definition hashes, parameters, execution order, and environment. These actual
captured inputs identify dirty runs more precisely than `HEAD` alone.

## Integration scripts

Scripts run in separate Node processes with the variant app as their working directory:

| Variable | Meaning |
|---|---|
| `BENCH_APP_ROOT` | Isolated app checkout with production `dist/` |
| `BENCH_OUTPUT` | Variant results directory |
| `BENCH_PARAMETERS` | JSON from the configuration plus CLI overrides |
| `BENCH_PROFILE` | `1` when separate profiling trials are requested |
| `BENCH_VARIANT` | `baseline` or `candidate` |

A script must exit nonzero when its correctness assertions fail. The included
fixture helper starts a production preview on a free port with disposable project
data; it never connects to the live development server. Browser, server, and fixture
cleanup runs on success and failure. Failure screenshots and server logs are retained.

Performance scripts write `BENCH_OUTPUT/measurements.json` with a `measurements`
array. Each entry contains `panes`, `gesture`, `trial`, `profile`, `mainThreadMs`,
`frameP95Ms`, `frameMaxMs`, and `elapsedMs`. Additional metrics and raw observations
are encouraged. The initial comparison reporter groups by pane count and gesture
and compares median durations, excluding entries marked `profile: true`. Extend
that small reporter when a benchmark needs a different scenario schema.

## Reading a run

Results are printed at startup and saved under ignored `benchmarks/.runs/<id>/`:

```text
manifest.json                 frozen inputs, hashes, status and environment
app-source.tar.gz             exact app snapshot, before replacements
definition/                   captured benchmark code and helpers
report.md                     median comparison
comparison.json               machine-readable comparison
baseline/ and candidate/
  install.log, build.log       build diagnostics
  correctness.log             assertions and failures
  measurements.json           raw timing trials and browser/graphics details
  performance/                screenshots and optional .cpuprofile files
```

Source/build directories and installed dependencies are removed at the end unless
`--keep-builds` is given. Results, captured inputs and logs remain available for review.
Failed runs retain a failed manifest and diagnostics and do not produce a success report.

Use multiple trials and repeat with `--candidate-first` before attributing small
differences to an implementation. The report is descriptive; it does not make a
statistical significance claim or enforce arbitrary performance thresholds. rAF
intervals measure main-thread frame callbacks, not compositor presentation. Graphics
backend, browser version, host load, and cache warmth can affect results.
