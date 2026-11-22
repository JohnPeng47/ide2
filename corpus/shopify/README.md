# Shopify filings and earnings calls

This corpus covers fiscal 2018 through the latest available earnings call as of November 6, 2026 (Q3 2026).

- `shopify-YYYY-annual-filing.txt`: searchable text extracted from each PDF with `pdftotext -layout`.
- `shopify-YYYY-qN-earnings-transcript.txt`: the public earnings call transcript for each quarter from Q1 2018 through Q3 2026, sourced from [Stock Analysis](https://stockanalysis.com/stocks/shop/transcripts/), which credits Quartr for the transcript text.
- `manifest.json`: source URL, fiscal period, file size, and SHA-256 checksum for every document file.

The filing text is extracted from PDFs and may have table layout artifacts. Only text files are stored locally; the manifest retains the original source URLs.
