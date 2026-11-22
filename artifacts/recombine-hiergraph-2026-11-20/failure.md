# Run 41e70224 · failed validation (3 model attempts, ~15 min)

- All 3 attempts (1 generation + 2 server validation retries) returned explanation > 10000 chars (11739, 10059, 10128).
- Raw outputs and usage recovered from Pi sessions into attempts/attempt-{1,2,3}.json (630,942 / 226,263 / 275,719 tokens).
- Local replay: each is valid apart from explanation length (3 canvases × 3 diagrams, 6 edges per canvas, 5 jumps).
- Defect not caught by validation: the model declared zero-based lines and columns with exclusive span ends. The materializer
  reads 1-based inclusive, so every edge and jump anchor lands one line too high. Cause: prompt v1's output-format section
  replaced the stock linked-canvases instructions and omitted the indexing convention.
