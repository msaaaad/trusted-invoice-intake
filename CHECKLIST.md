# Build Checklist

> Living document — updated as work progresses, committed alongside every
> meaningful chunk of work so progress is visible in git history, not just
> in the final diff. Organized by domain, matching `IMPLEMENTATION_PLAN.md`.
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done

**Last updated:** 2026-09-09 (domain 4)

---

## 1. Environment & Infrastructure
- [x] Repo scaffolded (`package.json`, `tsconfig.json`, folder layout)
- [x] `accounting_api.py` dropped in unmodified, packaged in `Dockerfile.accounting-api` (verified byte-identical to `TAKE_HOME.md` via diff)
- [x] `docker-compose.yml` — postgres + accounting-api + node app, 3 services
- [x] Prisma schema written (`Invoice`, `LineItem`, `InvoiceStatus` enum)
- [x] First migration run, DB reachable from the app container
- [x] Gemini API key obtained (free tier, aistudio.google.com) and wired via `.env`
- [x] `docker compose up --build` verified — all 3 containers up, migration applied, app connects via Prisma and queries the DB, exits 0
- [x] GitHub Actions CI: lint (ESLint), typecheck (`tsc --noEmit`), `prisma validate`, `accounting_api.py` vs. `TAKE_HOME.md` integrity diff, `docker compose build` — all 4 checks run green locally before commit

## 2. Extraction (LLM)
- [x] Prompt + forced JSON schema defined for invoice extraction (`src/gemini.ts`)
- [x] Handles all 3 file types: text-layer PDF, scanned-image PDF, JPG — confirmed on real files (invoice_01-03/09 = PDF, rest = JPG)
- [x] Ran against all 12 sample invoices, raw output stored in `Invoice.rawExtraction`
- [x] Spot-checked extraction by eye against the source image for each invoice — see findings below
- [x] Model explicitly asked to flag ambiguous/handwritten fields (`extractionNotes`) — confirmed working: invoice_08's "至急" stamp and handwritten bank-account correction were both flagged

**Model note:** `gemini-2.0-flash` (originally planned) was deprecated by
Google before this was run — the API returned 404 pointing at
`gemini-3.6-flash`, which is beyond this assistant's training data. Verified
live against the API directly (not assumed) before switching. Worth a line
in `SUBMISSION.md` §4/§7: the free-tier model landscape moves fast enough
that a take-home written one week and run the next can hit a deprecated
model name.

**Live run findings (all 12 invoices, spot-checked against manual reads from
early in this project):**
- All totals, line items, quantities, prices, and tax-code assignments
  matched exactly, including the hard cases: the 26-line 2-page invoice
  (invoice_02), mixed 8%/10% tax rates on one invoice (invoice_03, invoice_08),
  the duplicate pair (invoice_01/07, identical invoice number + amounts),
  the alias-only supplier name preserved as printed rather than normalized
  (invoice_06: "ヤマダ製作所"), the ¥1 printed-total mismatch reported as-is
  rather than self-corrected (invoice_09), the unknown supplier's name
  captured plainly (invoice_10), the Reiwa-era date passed through raw and
  unconverted (invoice_11: "令和8年2月5日"), and the negative discount line
  output as `-30000` (invoice_12)
- **New finding, not previously known:** invoice_01 and invoice_02 (both
  native PDFs) have a genuinely empty `unit` field for every line item in
  the *source document itself* — confirmed by comparing against the original
  PDF content, not a model miss. The accounting API requires `unit` as a
  non-empty string, so both invoices will fail registration on this field
  alone. Decision (to implement in domain 5/7, not now): treat a missing
  required field as a `NEEDS_REVIEW` trigger, never a guessed default -
  consistent with "never guess, flag for review" elsewhere in this project.
- No case of the model getting something wrong was found in this batch —
  worth noting honestly in `SUBMISSION.md` §5 rather than manufacturing one.

## 3. Normalization
- [x] Date parsing: standard `YYYY年M月D日` / `YYYY/MM/DD` formats → ISO (`src/normalize.ts`)
- [x] Date parsing: Reiwa era (`令和8年2月5日`) → ISO — confirmed against invoice_11: parsed to `2026-02-05` exactly
- [x] Amounts as integers — satisfied by construction, not separate coercion code: Gemini's forced JSON schema types amounts as numbers and Prisma's `Int` columns reject non-integers outright, so a violation would fail loudly rather than silently. Confirmed on all 12 real invoices, no coercion was ever needed.
- [x] Negative line items (`△` discount notation) handled — this is prompt/extraction behavior (domain 2), not a separate normalization step; confirmed live against invoice_12 (`-30000`) during domain 2's run

**Verified:** ran normalization against all 12 real (already-extracted) invoices.
All 12 dates parsed correctly on the first pass, including every format
actually present in the sample set (kanji-year, slash, and Reiwa era) —
confirmed by querying the DB afterward: all 12 rows still `EXTRACTED`, none
fell to `NEEDS_REVIEW`. Also added a small idempotency guard to `extract.ts`
(skip a file if it already has `rawExtraction` stored) so re-running the
pipeline while developing later domains doesn't re-spend Gemini quota on
files already done — this was needed to test domain 3 at all without
burning API calls on unrelated work.

## 4. Partner Resolution
- [x] `GET /partners` fetched once, cached for the run (`src/accountingApi.ts`, `src/resolvePartner.ts`)
- [x] Exact legal-name matching implemented
- [x] Alias matching implemented — confirmed against invoice_06: "ヤマダ製作所" (alias) resolved to P-1001, same code as invoice_01/07's full legal name "株式会社山田製作所"
- [x] No-match case produces `NEEDS_REVIEW`, not a guess — confirmed against invoice_10: "新星ロジスティクス株式会社" not in the partner master, correctly flagged rather than assigned a nearest-guess code

**Real bug hit and fixed during this domain:** the very first live run crashed
with a Prisma unique-constraint violation on `(partnerCode, invoiceNumber)`.
Root cause: assigning `partnerCode` is what *completes* that pair, so the
duplicate-invoice case (invoice_01/07, same invoice number, same supplier)
collides at partner-resolution time - not at the later dedupe/registration
stage domain 6 was originally planned to own. Fixed by checking for an
existing row with the same `(partnerCode, invoiceNumber)` before writing,
and routing the second one to `SKIPPED_DUPLICATE` with a reason pointing at
the original file, instead of letting the write throw. This effectively
pulls part of domain 6's job forward out of necessity - noted here rather
than silently absorbed, since it changes what domain 6 still has left to do
(the DB constraint + this check already cover the "two files, same invoice"
case; domain 6 still needs the pre-registration check against already
*registered* invoices from past runs).

**Verified:** ran against all 12 real invoices via the real accounting API
(not mocked). Final state: 10 resolved to a partner code, invoice_07 correctly
`SKIPPED_DUPLICATE`, invoice_10 correctly `NEEDS_REVIEW` - confirmed by
querying the DB directly, not just reading console output.

## 5. Verification
- [ ] Subtotal recomputed from line items independently of the model's extracted value
- [ ] Tax recomputed per tax code, floor-rounded, matching the API's own rule
- [ ] Total recomputed and diffed against extracted total
- [ ] Mismatch routes to `NEEDS_REVIEW` before any API call — confirmed against invoice_09 (¥1 rounding case)
- [ ] Mixed tax-rate invoices (8% + 10% on one invoice) computed correctly — confirmed against invoice_03
- [ ] Missing/empty required fields (e.g. `unit`) route to `NEEDS_REVIEW`, never a guessed default — found live on invoice_01/02 (see domain 2 findings), not yet implemented

## 6. Deduplication
- [x] DB unique constraint on `(partnerCode, invoiceNumber)` in place — done in domain 1
- [x] Constraint collision mapped to a clean `SKIPPED_DUPLICATE` status, not a raw DB error — done in domain 4 (pulled forward: the collision surfaces as soon as `partnerCode` is assigned, not later)
- [x] Confirmed against invoice_01 / invoice_07 (the deliberate duplicate pair) — invoice_07 never gets a partnerCode, never reaches the API
- [ ] **Still needed here, and it's a different gap than it first looked:** domain 4's check queries our own local DB, which already catches duplicates across any run (it's not batch-scoped). What it *can't* catch is the accounting system itself already holding a registration our local DB doesn't know about (local DB reset, or someone/something else registered it directly against the API) - that needs a live `GET /invoices` check against the accounting API immediately before `POST`, as the plan originally called for, not a substitute for domain 4's check but a second, independent layer against a different source of truth

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
