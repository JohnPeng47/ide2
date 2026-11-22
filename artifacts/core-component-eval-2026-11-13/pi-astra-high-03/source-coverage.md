# Pi source coverage

Three independent gpt-6-astra/high runs using unchanged prompt v2, pinned to Pi commit `682c7b93ce3e0a52b579c2b65b4c06bb392e7180`.

**Average per run: 3,058.3 unique source lines — 0.83% of eligible application source.**

The eligible source contains **368,377 lines across 1,715 files**.

| Run | Unique source lines read | Coverage |
|---|---:|---:|
| [1](http://localhost:5191/evals?run=5ff157b0-09da-4b19-bcf2-a8066c83031d) | 3,452 | 0.94% |
| [2](http://localhost:5191/evals?run=967708ee-ef6d-4a70-868d-252e4aa5dc4f) | 2,461 | 0.67% |
| [3](http://localhost:5191/evals?run=c5093116-76d6-4fc5-b6a6-cefab77ef511) | 3,262 | 0.89% |
| **Mean** | **3,058.3** | **0.83%** |

Across all three runs, 9,175 source-line exposures were counted after deduplicating within each run. The union across all runs is **4,872 distinct lines (1.32%)**.

All tracked code, including excluded tests/tooling, contains 794,943 lines across 3,597 files; average exposure against that broader denominator is 0.38%.

## Method

Physical source lines including comments/blanks, read and shell outputs; repeated file/line pairs deduplicated per run. Average coverage = sum of three run coverages / (3 × eligible source lines). Union deduplicates across all runs. Only complete returned lines count; listings, wc counts, prompts, JSON configs and generated diagrams excluded.

Coverage means the proportion of repository source returned to the model, rather than the proportion of context tokens occupied by code. The initial AgentContext contains a repository descriptor, not a bundled source dump. Shell output includes grep/rg, sed, cat and equivalent exact source excerpts. Tool output was checked against the pinned Git blobs, and file/line pairs were deduplicated.

This is deterministic trace analysis; it made no additional model calls. The three exact raw generations remain separate Markdown outputs. Canvas materialization failed the single-root parser check for all three; the original validation failures remain attached, and no repair generations were made.
