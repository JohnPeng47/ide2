# OpenCode source coverage

Three independent gpt-6-astra/high runs using prompt v4, pinned to commit `fe3552441192ccbea91d117668e7f3a9eb097baf`. All three ASCII outputs passed the single-root tree validator and were saved as canvas diagrams.

**Average per run: 4,013 unique source lines — 0.44% of eligible application source.**

The eligible source contains **915,717 lines across 5,019 files**.

| Run | Unique source lines read | Coverage |
|---|---:|---:|
| [1](http://localhost:5191/evals?run=450850af-6c9b-4950-a4d8-31f5724302e6) | 3,735 | 0.41% |
| [2](http://localhost:5191/evals?run=c896fde7-00ef-4b9f-a62f-7cfc94310a5b) | 3,669 | 0.40% |
| [3](http://localhost:5191/evals?run=e5dfe7ec-d1a8-45b9-bf7c-04ea78edf8da) | 4,635 | 0.51% |
| **Mean** | **4,013** | **0.44%** |

Across all three runs, 12,039 source-line exposures were counted after deduplicating within each run. The union across all runs is **5,833 distinct lines (0.64%)**.

All tracked code, including excluded tests/tooling, contains 1,416,740 lines across 7,169 files; average exposure against that broader denominator is 0.28%.

## Method

Physical source lines including comments/blanks, read and shell outputs; repeated file/line pairs deduplicated per run. Average coverage = sum of three run coverages / (3 × eligible source lines). Union deduplicates across all runs. Only complete returned lines count; listings, wc counts, prompts, JSON configs and generated diagrams excluded.

Coverage means the proportion of repository source returned to the model, rather than the proportion of context tokens occupied by code. The initial AgentContext contains a repository descriptor, not a bundled source dump. Shell output includes grep/rg, sed, cat and equivalent exact source excerpts. Returned text was checked against pinned Git blobs.

This is deterministic trace analysis; it made no additional model calls. The three generated diagrams remain separate canvas outputs.
