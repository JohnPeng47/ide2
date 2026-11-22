# Mapping source coverage

Two independent gpt-6-astra/high runs using prompt v4, pinned to commit `8ca143700ca4d2c870f1101b8cd4601ab68abd41`. Both ASCII outputs passed the single-root tree validator and were saved as canvas diagrams.

**Average per run: 3,097.5 unique source lines — 5.70% of eligible application source.**

The eligible source contains **54,363 lines across 594 files**.

| Run | Unique source lines read | Coverage |
|---|---:|---:|
| [1](http://localhost:5191/evals?run=641693cf-fc8b-43c8-ab5d-bc9b08dd22c7) | 3,137 | 5.77% |
| [2](http://localhost:5191/evals?run=c3aa93d2-4c2a-4e70-846c-61b571c3607d) | 3,058 | 5.63% |
| **Mean** | **3,097.5** | **5.70%** |

Across all two runs, 6,195 source-line exposures were counted after deduplicating within each run. The union across all runs is **4,059 distinct lines (7.47%)**.

All tracked code, including excluded tests/tooling, contains 103,157 lines across 1,051 files; average exposure against that broader denominator is 3.00%.

## Method

Physical source lines including comments/blanks, read and shell outputs; repeated file/line pairs deduplicated per run. Average coverage = sum of run coverages / (sample count × eligible source lines). Union deduplicates across all runs. Only complete returned lines count; listings, wc counts, prompts, JSON configs and generated diagrams excluded.

Coverage means the proportion of repository source returned to the model, rather than the proportion of context tokens occupied by code. The initial AgentContext contains a repository descriptor, not a bundled source dump. Shell output includes grep/rg, sed, cat and equivalent exact source excerpts. Returned text was checked against pinned Git blobs.

This is deterministic trace analysis; it made no additional model calls. The two generated diagrams remain separate canvas outputs.
