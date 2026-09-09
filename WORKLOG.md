# Work Log

Keeping this so the "hours actually spent" field in SUBMISSION.md is an
honest number, not a guess after the fact. Rough is fine - this is for me,
not for show.

## 2026-09-08 (night)

Read TAKE_HOME.md properly and went through all 12 invoices by hand before
writing anything, since the assignment says deciding what to build is the
actual point. Turned out the 12 samples aren't random - they're built to
hit specific edge cases (a duplicate invoice, an unknown supplier, mixed tax
rates, handwriting, a Reiwa-era date, a negative line item). Good thing I
looked before planning instead of after.

Went back and forth on a few calls: JSON files vs. a real database, and
which LLM given I don't have a paid API key. Landed on Postgres + Prisma
(it's my daily stack, and it gives me a real duplicate-protection
constraint instead of code I have to remember to write correctly) and
Gemini's free tier (no card needed, handles Japanese and handwriting fine).

Wrote IMPLEMENTATION_PLAN.md and CHECKLIST.md before touching code, set up
the git repo. Almost midnight by the time the plan felt solid - decided not
to start actual coding tired, stopped here.

Time: ~1.5h (reading the brief and all 12 invoices properly, the JSON-vs-Postgres
and LLM back-and-forth, writing the plan and checklist, git setup)

## 2026-09-09

**Domain 1 (env/infra + CI) - ~0.75h:** Docker Compose (postgres + the
unmodified accounting_api.py + the app), Prisma schema, GitHub Actions. Hit
two real bugs getting the stack to actually boot - missing OpenSSL in the
node:20-slim image, and the Dockerfile trying to run compiled TypeScript
that was never compiled - fixed both before calling it done.

**Domain 2 (extraction) - ~1.5h:** Got the Gemini key, hit a wall
immediately - the model I'd planned around (gemini-2.0-flash) had been
deprecated. Had to hit the API directly to find out what was actually
still live rather than guessing from stale docs. Ran extraction against
all 12 real invoices and checked every result against my own manual read
from the night before - everything matched, including all the deliberate
trap cases. Found one thing I hadn't planned for: two invoices have a
genuinely empty "unit" field in the source PDF itself, not a reading error.

**Domain 3 (normalization) - ~0.3h:** Date parsing, including the Reiwa-era
conversion. Quick, since domain 2 was designed to pass raw dates through
untouched specifically so this step would have something clean to work on.

**Domain 4 (partner resolution) - ~0.5h:** Crashed on the first real run -
a database constraint violation. The duplicate-invoice case I'd planned to
handle later (domain 6) actually surfaces here, the moment two invoices
resolve to the same partner + invoice number. Fixed it, which also changed
what domain 6 still needed to do.

**Domain 5 (verification) - ~0.5h:** Recomputing subtotal/tax/total myself
instead of trusting the extracted numbers. Caught the deliberate ¥1
mismatch invoice exactly as intended. Ended up with exactly half the batch
needing review, for six different reasons - higher than I expected going in.

**Domain 6+7 (dedupe + registration) - ~0.75h:** The live duplicate check
against the accounting API, and actual registration. Registered 6 real
invoices and got real ACC-#### ids back. Deliberately broke my own
database (reset an already-registered row) to prove the live check would
catch what a local-only check couldn't - it did.

**Domain 8 (reporting) - ~0.25h:** Final summary/detail report + JSON
audit export.

**Domain 9 (docs) - ~0.5h:** README, this file, SUBMISSION.md.

**Git/PR housekeeping across the whole day - ~0.5h:** branch-per-domain
workflow, PR descriptions, and cleaning up commit trailers twice after the
fact - small each time, adds up across 8 branches.

**Full clean-clone verification - ~1h:** cloned into an isolated directory,
ran the documented single command with nothing but a fresh .env, confirmed
it reproduced the exact same result as the working directory. Hit and
worked through real flakiness along the way - a network error and repeated
Gemini 503s - rather than a clean first try.

**Domain 11 (low-confidence handling + HTML report) - ~1h:** Added a check
for the model's own flagged uncertainty; it changed a real result
(invoice_08 moved from auto-registered to held for review). Building it
led straight into a real problem: hit an actual 429 quota-exceeded error,
discovered the free tier is 20 requests/day/model (not the "generous
quota" I'd assumed in the plan), and had to correct that claim in
SUBMISSION.md rather than leave it wrong. Worked around the exhausted
quota by replaying already-captured real extraction data instead of
burning more calls.

Time: ~7.6h

---

**Total hours actually spent: ~9h** (1.5h night-of planning + ~7.6h
implementation day). This is a reasoned reconstruction from what was
actually built/tested/debugged session by session, not a stopwatch log -
adjust if your own memory of the elapsed time differs.
