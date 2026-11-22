# Pi source coverage

Three independent gpt-6-astra/high runs using prompt v4, pinned to commit `682c7b93ce3e0a52b579c2b65b4c06bb392e7180`. All three ASCII outputs passed the single-root tree validator and were saved as canvas diagrams.

**Average per run: 2,608 unique source lines — 0.71% of eligible application source.**

The eligible source contains **368,377 lines across 1,715 files**.

| Run | Unique source lines read | Coverage |
|---|---:|---:|
| [1](http://localhost:5191/evals?run=3f123c60-c475-4fbc-958f-c66dbb757de2) | 2,296 | 0.62% |
| [2](http://localhost:5191/evals?run=c5923f60-da9e-4740-ab82-74fad423bda1) | 3,006 | 0.82% |
| [3](http://localhost:5191/evals?run=0fc465ae-961d-4c0a-a0c6-f60338bbe689) | 2,522 | 0.68% |
| **Mean** | **2,608** | **0.71%** |

Across all three runs, 7,824 source-line exposures were counted after deduplicating within each run. The union across all runs is **4,247 distinct lines (1.15%)**.

All tracked code, including excluded tests/tooling, contains 794,943 lines across 3,597 files; average exposure against that broader denominator is 0.33%.

## Method

Physical source lines including comments/blanks, read and shell outputs; repeated file/line pairs deduplicated per run. Average coverage = sum of three run coverages / (3 × eligible source lines). Union deduplicates across all runs. Only complete returned lines count; listings, wc counts, prompts, JSON configs and generated diagrams excluded.

Coverage means the proportion of repository source returned to the model, rather than the proportion of context tokens occupied by code. The initial AgentContext contains a repository descriptor, not a bundled source dump. Shell output includes grep/rg, sed, cat and equivalent exact source excerpts. Returned text was checked against pinned Git blobs.

This is deterministic trace analysis; it made no additional model calls. The three generated diagrams remain separate canvas outputs.
