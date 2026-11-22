# Ghostty source coverage

Three independent gpt-6-astra/high runs using prompt v4, pinned to commit `ea8b12a8a9894b5259c441eadd8f6f0c65e215af`. All three ASCII outputs passed the single-root tree validator and were saved as canvas diagrams.

**Average per run: 2,978.7 unique source lines — 0.55% of eligible application source.**

The eligible source contains **542,715 lines across 1,004 files**.

| Run | Unique source lines read | Coverage |
|---|---:|---:|
| [1](http://localhost:5191/evals?run=3d97670a-8d2d-41fe-86c6-7b3914204965) | 3,134 | 0.58% |
| [2](http://localhost:5191/evals?run=87b0635d-e644-43cd-856a-81c73fbc2af6) | 3,059 | 0.56% |
| [3](http://localhost:5191/evals?run=d8ddfcb7-6be0-4a68-9277-c40a1254248f) | 2,743 | 0.51% |
| **Mean** | **2,978.7** | **0.55%** |

Across all three runs, 8,936 source-line exposures were counted after deduplicating within each run. The union across all runs is **4,210 distinct lines (0.78%)**.

All tracked code, including excluded tests/tooling, contains 583,357 lines across 1,237 files; average exposure against that broader denominator is 0.51%.

## Method

Physical source lines including comments/blanks, read and shell outputs; repeated file/line pairs deduplicated per run. Average coverage = sum of three run coverages / (3 × eligible source lines). Union deduplicates across all runs. Only complete returned lines count; listings, wc counts, prompts, JSON configs and generated diagrams excluded.

Coverage means the proportion of repository source returned to the model, rather than the proportion of context tokens occupied by code. The initial AgentContext contains a repository descriptor, not a bundled source dump. Shell output includes grep/rg, sed, cat and equivalent exact source excerpts. Returned text was checked against pinned Git blobs.

This is deterministic trace analysis; it made no additional model calls. The three generated diagrams remain separate canvas outputs.
