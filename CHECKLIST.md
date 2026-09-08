# Build Checklist

> Living document — updated as work progresses, committed alongside every
> meaningful chunk of work so progress is visible in git history, not just
> in the final diff. Organized by domain, matching `IMPLEMENTATION_PLAN.md`.
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done

**Last updated:** 2026-09-08

---

## 1. Environment & Infrastructure
- [x] Repo scaffolded (`package.json`, `tsconfig.json`, folder layout)
- [x] `accounting_api.py` dropped in unmodified, packaged in `Dockerfile.accounting-api` (verified byte-identical to `TAKE_HOME.md` via diff)
- [x] `docker-compose.yml` — postgres + accounting-api + node app, 3 services
- [x] Prisma schema written (`Invoice`, `LineItem`, `InvoiceStatus` enum)
- [x] First migration run, DB reachable from the app container
- [ ] Gemini API key obtained (free tier, aistudio.google.com) and wired via `.env` — `.env` scaffolded with the field, key itself not yet obtained
- [x] `docker compose up --build` verified — all 3 containers up, migration applied, app connects via Prisma and queries the DB, exits 0

## 2. Extraction (LLM)
- [ ] Prompt + forced JSON schema defined for invoice extraction
- [ ] Handles all 3 file types: text-layer PDF, scanned-image PDF, JPG
- [ ] Ran against all 12 sample invoices, raw output stored in `Invoice.rawExtraction`
- [ ] Spot-checked extraction by eye against the source image for each invoice
- [ ] Model explicitly asked to flag ambiguous/handwritten fields (`extraction_notes`)

## 3. Normalization
- [ ] Date parsing: standard `YYYY年M月D日` / `YYYY/MM/DD` formats → ISO
- [ ] Date parsing: Reiwa era (`令和8年2月5日`) → ISO — confirmed against invoice_11
- [ ] Amounts coerced to integers (strip `¥`, commas)
- [ ] Negative line items (`△` discount notation) handled — confirmed against invoice_12

## 4. Partner Resolution
- [ ] `GET /partners` fetched once, cached for the run
- [ ] Exact legal-name matching implemented
- [ ] Alias matching implemented — confirmed against invoice_06 (alias-only supplier name)
- [ ] No-match case produces `NEEDS_REVIEW`, not a guess — confirmed against invoice_10 (unknown supplier)

## 5. Verification
- [ ] Subtotal recomputed from line items independently of the model's extracted value
- [ ] Tax recomputed per tax code, floor-rounded, matching the API's own rule
- [ ] Total recomputed and diffed against extracted total
- [ ] Mismatch routes to `NEEDS_REVIEW` before any API call — confirmed against invoice_09 (¥1 rounding case)
- [ ] Mixed tax-rate invoices (8% + 10% on one invoice) computed correctly — confirmed against invoice_03

## 6. Deduplication
- [ ] DB unique constraint on `(partnerCode, invoiceNumber)` in place
- [ ] Pre-check query against existing `REGISTERED` rows before attempting insert
- [ ] Constraint violation mapped to a clean `SKIPPED_DUPLICATE` status, not a raw DB error
- [ ] Confirmed against invoice_01 / invoice_07 (the deliberate duplicate pair) — second one never reaches the API

## 7. Accounting API Integration
- [ ] `POST /invoices` client implemented, correct payload shape
- [ ] Every documented error code mapped to a specific status (see plan §4 table)
- [ ] `X-API-Key` header handling, `401` path tested
- [ ] Successful registrations store `accountingId` back on the row
- [ ] Full run produces one status per invoice for all 12 samples, no unhandled exceptions

## 8. Audit Trail & Reporting
- [ ] Final report query (`status, count(*) GROUP BY status`) implemented
- [ ] Per-invoice detail view possible (raw extraction → normalized → check result → API outcome)
- [ ] Report exportable (console table minimum; CSV/JSON export if time allows)

## 9. Documentation
- [ ] `README.md` — single command to run, prerequisites, `.env.example` explained
- [ ] `SUBMISSION.md` — all 8 sections filled in, following the required headings exactly
- [ ] `IMPLEMENTATION_PLAN.md` kept in sync with what was actually built (deviations noted)
- [ ] `WORKLOG.md` — session hours logged honestly for the "hours actually spent" field

## 10. Validation Against the 12 Known Edge Cases
> One line per invoice — filled in as each is confirmed working end-to-end.

| # | Trap | Confirmed handled? |
|---|---|---|
| 01/07 | Exact duplicate invoice (PDF + re-scan) | [ ] |
| 02 | Multi-page invoice, 26 line items | [ ] |
| 03 | Mixed tax rates (8% + 10%) on one invoice | [ ] |
| 04 | Handwritten received-stamp overlay | [ ] |
| 06 | Supplier printed as alias only, not legal name | [ ] |
| 08 | Handwritten correction to bank details | [ ] |
| 09 | ¥1 rounding mismatch vs. printed total | [ ] |
| 10 | Supplier not in partner master at all | [ ] |
| 11 | Reiwa-era date format | [ ] |
| 12 | Negative line item (discount) | [ ] |

## 11. Optional / Stretch (only if time remains after §1–10)
- [ ] Minimal review surface for `NEEDS_REVIEW` rows (even just a formatted DB query/export)
- [ ] Cost estimate write-up (§7 of `SUBMISSION.md`)
- [ ] Low-confidence handling beyond the two hard checks already in place

## 12. Final Submission
- [ ] All required deliverables present: source, `SUBMISSION.md`, demo video/screenshots
- [ ] Repo pushed, README instructions tested from a truly clean clone
- [ ] Submission reviewed once, end to end, before sending
