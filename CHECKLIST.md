# Build Checklist

> Living document — updated as work progresses, committed alongside every
> meaningful chunk of work so progress is visible in git history, not just
> in the final diff. Organized by domain, matching `IMPLEMENTATION_PLAN.md`.
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done

**Last updated:** 2026-09-09 (domain 11 — low-confidence handling + HTML report, and a real free-tier quota correction)

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
- [x] Subtotal recomputed from line items independently of the model's extracted value (`src/verify.ts`)
- [x] Tax recomputed per tax code, floor-rounded, matching the API's own rule — deliberately kept as plain `Math.floor(subtotal * 0.10)` float math, not integer-safe math, because JS and Python both use IEEE754 doubles: this predicts the API's actual floating-point result exactly, where a "more correct" integer version could silently diverge from it
- [x] Total recomputed and diffed against extracted total
- [x] Mismatch routes to `NEEDS_REVIEW` before any API call — confirmed against invoice_09: caught the exact ¥1 case (expected 147496, extracted 147497)
- [x] Mixed tax-rate invoices (8% + 10% on one invoice) computed correctly — confirmed against invoice_03 and invoice_08
- [x] Missing/empty required fields (`unit`) route to `NEEDS_REVIEW`, never a guessed default — implemented and confirmed
- [x] Bonus (not originally listed, cheap to add): due-date-before-issue-date check, mirroring the API's own `DUE_DATE_BEFORE_ISSUE_DATE` rule

**The missing-`unit` finding turned out bigger than domain 2 suggested.** It's
not just invoice_01/02 - invoice_03's "配送手数料" (delivery fee) line is
missing a unit too, in an otherwise-clean invoice with proper units on its
other 3 lines. Pattern: flat-fee/lump-sum lines (delivery, freight, shipping)
frequently have no quantity/unit/unit_price on the source invoice at all,
which is realistic - a flat fee genuinely isn't measured in a unit. This is
a real structural mismatch between how these invoices are written and what
the accounting API's schema requires, not an extraction accuracy problem.

**Verified: ran against all 12 real invoices.** Final tally, confirmed via
direct DB query:

| Status | Invoices | Reason |
|---|---|---|
| Ready (still `EXTRACTED`) | 04, 05, 06, 08, 11, 12 | passed every check |
| `NEEDS_REVIEW` | 01, 02, 03 | missing required `unit` field |
| `NEEDS_REVIEW` | 09 | ¥1 total mismatch (the deliberate trap) |
| `NEEDS_REVIEW` | 10 | unknown supplier (domain 4) |
| `SKIPPED_DUPLICATE` | 07 | duplicate of invoice_01 (domain 4) |

**Exactly half the batch (6/12) needs human review**, for six genuinely
different reasons spanning three different domains (extraction data gaps,
arithmetic mismatch, partner mismatch, duplication). This is real, useful
material for SUBMISSION.md's "automation vs. human review" discussion -
also confirms invoice_12's negative discount line (`-30000`) flows through
the subtotal/tax/total recompute correctly without special-casing.

## 6. Deduplication
- [x] DB unique constraint on `(partnerCode, invoiceNumber)` in place — done in domain 1
- [x] Constraint collision mapped to a clean `SKIPPED_DUPLICATE` status, not a raw DB error — done in domain 4 (pulled forward: the collision surfaces as soon as `partnerCode` is assigned, not later)
- [x] Confirmed against invoice_01 / invoice_07 (the deliberate duplicate pair) — invoice_07 never gets a partnerCode, never reaches the API
- [x] Live `GET /invoices` check (`src/register.ts`) fetched once per run, independent of our own DB - the second layer domain 4's fix couldn't provide

**Verified the live check actually does something, not just that it exists:**
after a normal run registered 6 invoices, manually reset one already-`REGISTERED`
row (invoice_04) back to `EXTRACTED` with `accountingId: null` - simulating our
local DB losing track of a registration the accounting system still remembers.
Reran the pipeline: it correctly caught the collision via the live check and
routed it to `SKIPPED_DUPLICATE` instead of double-`POST`ing. Restored the
row's correct state afterward. This is exactly the failure mode a local-DB-only
check can't catch, proven, not assumed.

## 7. Accounting API Integration
- [x] `POST /invoices` client implemented, correct payload shape (`src/accountingApi.ts`)
- [x] Every documented error code mapped to a specific status: `PARTNER_NOT_FOUND`→`FAILED_PARTNER`, `DUPLICATE_INVOICE`→`FAILED_DUPLICATE`, `AMOUNT_MISMATCH`→`FAILED_AMOUNT`, `UNKNOWN_TAX_CODE`/`DUE_DATE_BEFORE_ISSUE_DATE`/`VALIDATION_ERROR`→`FAILED_VALIDATION` (raw code preserved in `apiErrorCode` regardless); anything unmapped also falls back to `FAILED_VALIDATION` with the real code kept, since that firing at all would mean a bug in this integration, not a data problem
- [x] `X-API-Key` header handling confirmed working (all 6 real registrations succeeded); wrong-key path tested directly - fails cleanly with `UNAUTHORIZED`/the exact API message, no crash or hang
- [x] Successful registrations store `accountingId` back on the row
- [x] Full run produces one status per invoice for all 12 samples, no unhandled exceptions

**Verified: ran the full pipeline end to end against the real accounting API.**
Final result for all 12 invoices, confirmed both via direct DB query and
`GET /invoices` on the live API:

| Status | Invoices |
|---|---|
| `REGISTERED` (ACC-0001..0006) | 04, 05, 06, 08, 11, 12 |
| `NEEDS_REVIEW` (missing unit) | 01, 02, 03 |
| `NEEDS_REVIEW` (¥1 amount mismatch) | 09 |
| `NEEDS_REVIEW` (unknown supplier) | 10 |
| `SKIPPED_DUPLICATE` | 07 |

All 6 registered totals matched the source invoices exactly, including
invoice_12's negative discount line flowing through registration correctly
(subtotal 540,000 / tax 54,000 / total 594,000). Reran the full pipeline a
second time afterward with zero changes in output - confirms the whole
7-domain pipeline is idempotent end to end, not just individual steps.

## 8. Audit Trail & Reporting
- [x] Final report query (`status, count(*) GROUP BY status`) implemented (`src/report.ts`)
- [x] Per-invoice detail view possible — every stage's output already lives on the `Invoice` row (`rawExtraction`, normalized fields, `reviewReason`, `apiErrorCode`, `accountingId`), so the "view" is just reading the row, not a separate log to reconstruct
- [x] Report exportable — console summary + detail table, plus a full JSON export to `data/report.json` (gitignored, regenerated each run)

**Verified:** ran as the last step of the full pipeline. Summary matched the
known final tally exactly (`NEEDS_REVIEW: 5, REGISTERED: 6, SKIPPED_DUPLICATE: 1`),
and `data/report.json` confirmed to contain all 12 rows.

## 9. Documentation
- [x] `README.md` — single command to run, prerequisites, `.env.example` explained
- [x] `SUBMISSION.md` — all 8 sections filled in, required headings preserved exactly. Written in first person, from the real decisions and findings made across this project - not a generic writeup
- [x] `IMPLEMENTATION_PLAN.md` — **deliberately not kept in sync, by decision, not oversight.** It's a local-only planning doc (already gitignored) for aligning before writing code; it did its job during domains 1-2 and isn't part of the deliverable. Not worth spending time reconciling a doc nobody grading this will see.
- [x] `WORKLOG.md` — real session dates and what happened in each one written honestly; actual hour totals left as explicit blanks for honest self-report rather than guessed, since that's not something to fabricate

## 10. Validation Against the 12 Known Edge Cases
> One line per invoice — filled in as each is confirmed working end-to-end.

| # | Trap | Confirmed handled? |
|---|---|---|
| 01/07 | Exact duplicate invoice (PDF + re-scan) | [x] domain 4: invoice_07 → `SKIPPED_DUPLICATE`, never reaches the API |
| 02 | Multi-page invoice, 26 line items | [x] domain 2: all 26 lines extracted correctly, exact total match |
| 03 | Mixed tax rates (8% + 10%) on one invoice | [x] domain 5: per-line tax computed correctly (also confirmed on invoice_08) |
| 04 | Handwritten received-stamp overlay | [x] domain 2: registered cleanly (ACC-0001), stamp didn't confuse extraction |
| 06 | Supplier printed as alias only, not legal name | [x] domain 4: "ヤマダ製作所" → `P-1001`, same code as the legal name |
| 08 | Handwritten correction to bank details | [x] domain 2: flagged in `extractionNotes`, registered cleanly since the correction wasn't on a registered field |
| 09 | ¥1 rounding mismatch vs. printed total | [x] domain 5: caught exactly (`expected 147496, extracted 147497`) → `NEEDS_REVIEW` |
| 10 | Supplier not in partner master at all | [x] domain 4: → `NEEDS_REVIEW`, no guessed match |
| 11 | Reiwa-era date format | [x] domain 3: `令和8年2月5日` → `2026-02-05` exactly |
| 12 | Negative line item (discount) | [x] domain 2/5: `-30000` extracted and flowed through recompute + registration correctly |

## 11. Optional / Stretch (only if time remains after §1–10)
- [ ] Minimal review surface for `NEEDS_REVIEW` rows — **explicitly the user's own call, not built by me.** `data/report.json`, the `Invoice` table, and now `data/report.html` (below) are reviewable as-is; a real edit/resubmit screen is still listed as priority #1 in `SUBMISSION.md` §8.
- [x] Cost estimate write-up (§7 of `SUBMISSION.md`) — done as part of domain 9, and substantially corrected afterward (see below)
- [x] Low-confidence handling beyond the two hard checks — **built and verified.** `src/verify.ts` now treats a non-empty `extractionNotes` (the model's own uncertainty signal, captured since domain 2 but previously just logged) as a third check: any flagged uncertainty routes to `NEEDS_REVIEW`, full stop, regardless of whether the math checks out.
- [x] **Bonus, not originally listed:** `src/reportHtml.ts` - a small, self-contained static HTML report (`data/report.html`) alongside the JSON export. No backend, no server - the invoice data is embedded directly in the file, opens in any browser via `file://`. Status badges, a filter by status, and an expandable line-item view per invoice. Built purely for demo/visual purposes, not as the "review surface" above - it's read-only, no edit/resubmit capability.

**Verified: reset the local DB and replayed the 12 real, previously-captured
extraction results (from `data/report.json`, saved before this change) through
the updated pipeline** - no new Gemini calls needed, which mattered because
live testing that same day had already hit the free tier's daily quota wall
(see the correction in `SUBMISSION.md` §7). Result: **invoice_08 flipped from
`REGISTERED` to `NEEDS_REVIEW`** - it has a handwritten stamp and a
handwritten bank-account correction that the model had already flagged in
`extractionNotes` since domain 2, but nothing acted on that signal until now.
New final tally: `NEEDS_REVIEW: 6, REGISTERED: 5, SKIPPED_DUPLICATE: 1` -
different from the `5/6/1` split domains 5, 7, and 8 recorded, because this
domain changed what counts as "safe to register," not because anything
upstream broke. `SUBMISSION.md` §6 and §7 updated to match this real number,
not the earlier one.

**Also discovered here, and important enough to flag on its own:** while
testing this change, hit a real `429 Too Many Requests` - the Gemini free
tier is capped at **20 requests/day per project per model**, far tighter
than "generous quota" as originally written in the plan. This directly
contradicted an earlier claim in `SUBMISSION.md`; corrected there rather
than left standing. Also hit two more rounds of transient `503`/network
failures on top of the ones from the clean-clone test, on different files
each time - reinforcing that this isn't bad luck on one file, it's a real,
recurring gap that retry/backoff would need to solve.

## 12. Final Submission
- [x] All required deliverables present: source ✅, `SUBMISSION.md` ✅, demo video ✅ (recorded live on 2026-09-11, linked in `SUBMISSION.md`'s header)
- [x] Repo pushed, README instructions tested from a truly clean clone — actually done, not assumed: cloned into a separate directory, copied only `.env.example` + a real key, ran the exact `docker compose up --build` from the README with nothing else. Final result matched the known outcome exactly (5 `NEEDS_REVIEW`, 6 `REGISTERED`, 1 `SKIPPED_DUPLICATE`).
- [x] Submission reviewed end to end — user did the voice/Name pass on `SUBMISSION.md` themselves; hours and demo link filled in as the last step

**The demo recording itself hit two real failures live** - a Gemini `503`
mid-run and the actual `429` daily quota cap on the very last invoice,
needing a second API key (a different Google Cloud project) to finish.
Kept in as genuine evidence of the exact risk `SUBMISSION.md` §7 already
describes, not edited around. Also found and fixed a real (cosmetic)
bug while watching logs closely for the first time: the postgres
healthcheck was checking a database named after the user rather than
the actual database name.

**Real finding from the clean-clone test, not hypothetical:** hit a `TypeError:
fetch failed` on the first attempt, then a Gemini `503 Service Unavailable`
("high demand") four times in a row on the same file (invoice_07) before it
went through on the sixth attempt - while every other file succeeded on the
first try, including that same file in earlier runs. This is exactly the
"no retries" gap already scoped out in `SUBMISSION.md` §7, now backed by an
actual witnessed failure instead of a guess. Folded the concrete detail into
§7's "where this breaks first" answer.
