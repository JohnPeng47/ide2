# Shopify filings and earnings calls

This corpus covers fiscal 2018 through the latest available earnings call as of November 6, 2026 (Q3 2026).

- `shopify-YYYY-annual-filing.pdf`: the annual SEC filing from Shopify's investor document hosts. Fiscal 2018 through 2023 are Form 40-F; fiscal 2024 and 2025 are Form 10-K.
- `shopify-YYYY-annual-filing.txt`: searchable text extracted from each PDF with `pdftotext -layout`.
- `shopify-YYYY-qN-earnings-transcript.txt`: the public earnings call transcript for each quarter from Q1 2018 through Q3 2026, sourced from [Stock Analysis](https://stockanalysis.com/stocks/shop/transcripts/), which credits Quartr for the transcript text.
- `manifest.json`: source URL, fiscal period, file size, and SHA-256 checksum for every document file.

The filing text is extracted from PDFs and may have table layout artifacts. The PDFs remain the source of record.
