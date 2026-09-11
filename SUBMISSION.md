# Submission

- Name: Moinul Islam Shad
- Submission date (YYYY-MM-DD): 2026-09-11
- Hours actually spent: ~9.75 hours (see WORKLOG.md for the session-by-session breakdown - this went past the 8-hour target, and section 3 explains the scoping decisions that came with that)
- Repository / how to run it: github.com/msaaaad/trusted-invoice-intake - `cp .env.example .env`, set `GEMINI_API_KEY`, then `docker compose up --build`. Details in README.md.
- Demo video: https://www.awesomescreenshot.com/video/56410890?key=44fddf0f422c79551213b119d5598e5f

## 1. Understanding the request

The email says "read invoices with AI and enter them automatically," but
the detail that actually matters is one line in there: accounting almost
paid the same invoice twice because of a typo. That's not an OCR problem,
it's a trust problem. The client isn't asking for a faster way to make the
same kind of mistake - they're asking for a way to stop making it.

So the problem I decided to solve wasn't "can an LLM read a Japanese
invoice" - current models handle that fine, and the assignment says as
much. It was "can I build something that only auto-enters an invoice when
I'm actually confident it's right, and safely stops and asks a human
otherwise." Concretely, that meant treating extraction as maybe a third of
the work and spending the rest on independent verification (recomputing
the numbers myself instead of trusting what the model read) and duplicate
protection - both in my own database and against the live accounting
system, since a duplicate payment is the literal incident that prompted
this whole project.

## 2. What you would have asked the client

| What you wanted to ask | The assumption you made | Why |
|---|---|---|
| What actually happens to an invoice I can't auto-register - who looks at it, how fast? | Someone in accounting reviews it before month-end close, not in real time | There's no review process today (it's 100% manual entry), so I assumed whatever handles exceptions now is roughly what would handle my review pile too |
| Is a duplicate submission across separate runs (not just within one batch) a real risk, or was the near-miss a one-off? | Yes, always check, even across restarts | It's literally the incident described in the email - didn't want to gamble on it not happening again |
| If the model isn't fully confident about something, should it ever auto-register with a flag, or never? | Never - anything uncertain blocks registration entirely | Given the stated fear is a wrong payment, missing an invoice (false negative) is a much cheaper mistake than paying wrong (false positive) |
| Is JPY the only currency I need to handle? | Yes | The API only accepts JPY and all 12 samples are JPY - no reason to build multi-currency support for a problem that isn't in the data |
| What should happen when a required field (like unit) is genuinely blank on the source document, not just hard to read? | Treat it exactly like any other verification failure - hold for review, never invent a value | Found out live this isn't hypothetical - it happens on 3 of the 12 samples, mostly on flat-fee lines (delivery, freight) that don't naturally have a unit at all |

## 3. Scoping decisions

**What you built**

The full pipeline, run for real, not just written: extract (Gemini vision)
→ normalize dates (including Reiwa era) → resolve partner name/alias →
verify (recompute subtotal/tax/total myself, check required fields) →
dedupe (a database constraint plus a live check against the accounting
API) → register → audit report. Every stage was actually run against the
12 real sample invoices and the (mock) accounting API before I called it
done - not assumed to work because the code looked right. I hit and fixed
three real bugs doing that (a Docker image missing OpenSSL, a duplicate
case surfacing one pipeline stage earlier than planned, a deprecated LLM
model), all documented with what actually happened in CHECKLIST.md.

**What you left out, and why**

- A review UI. `NEEDS_REVIEW` invoices are database rows / a JSON export
  right now - reviewable, not pleasant. A proper approve/correct/resubmit
  screen is realistically its own half-day on top of this, and I'd rather
  ship a correct pipeline with an ugly review step than a nice screen in
  front of a pipeline I hadn't fully verified.
- Retries, backoff, a queue. Fine for running 12 invoices once; matters at
  real volume, not worth the hours here.
- **Per-field** confidence modeling. I did add a third check beyond
  recompute + dedupe: if Gemini's own `extractionNotes` field is non-empty
  (it flags handwriting, corrections, anything it wasn't sure about), the
  whole invoice goes to review rather than being trusted just because the
  math checks out. What I didn't build is the more granular version - one
  uncertain field sending only that field for review instead of the whole
  invoice. That's still cut, for the same time-budget reason.
- Cloud deployment. Everything's local Docker Compose - matches "something
  working," not "production infrastructure."

I cut in that order because the two things the CEO's email actually cares
about - don't double-pay, don't silently do something wrong - are exactly
what the recompute and dedupe checks cover. Everything else is quality of
life on top of a pipeline that already does the thing that was asked for.

## 4. Design and technology choices

Flow: invoice file → Gemini vision call with a forced JSON schema →
written to a database row → date normalization → partner name/alias match
→ recompute-and-diff check → dedupe check (local constraint, then a live
call to the accounting API) → `POST` to the accounting API → the same row
updated with the final outcome.

**TypeScript / Node, no framework.** It's my day-to-day stack (NestJS /
Next.js background) and the brief allows it. I didn't reach for NestJS
here - this is a batch job over 12 files, not a running service, and a
flat pipeline is easier to read than dependency-injected modules for
something this size.

**Postgres + Prisma instead of just writing JSON files to disk.** I
actually started with the JSON-files plan and changed it on purpose: the
whole point of this project is catching duplicates, and a real unique
constraint on (partner code, invoice number) makes that structural instead
of "code I hopefully wrote correctly and never break." It also gives a
persistent audit trail that survives across separate runs. It's also
genuinely the fastest stack for me personally to build in.

**Gemini, free tier, no separate OCR engine.** A vision model reads the
PDF/image bytes directly, so one code path handles all three file types
(text-layer PDF, scanned PDF, plain image) instead of three different
ones. I'd planned around `gemini-2.0-flash`; by the time I actually had a
key and ran this, Google had deprecated it. I hit the API directly to find
out what was actually still live (`gemini-3.6-flash`) instead of guessing
from documentation that was already stale. I picked Gemini over Claude or
OpenAI specifically because it has a real no-card free tier - that's a
budget decision, not a quality judgment. Turned out the free tier is more
limited than I assumed going in (see §7) - still the right call for a
take-home with no budget, just not something I'd plan a production volume
around without checking current limits and pricing first.

**Docker Compose, 3 services** (postgres, the *unmodified*
`accounting_api.py`, the app) so the whole thing stays one command
(`docker compose up --build`) even with a real database in the loop.

**What I decided against:** any agent framework or orchestration library.
This isn't an agentic task - it's read, check, write, in a fixed order,
every time. Reaching for something like LangChain here would be adding a
dependency to look sophisticated, not to solve an actual problem this
project has.

## 5. How you used AI, and how you checked it

**What you delegated to AI**

Basically all of the code in this repository - I built this with Claude
Code, describing what I wanted at each stage and directing/reviewing the
output rather than typing every line by hand. That includes the extraction
prompt itself, the pipeline code, the Docker and CI setup, and this
document. What I didn't delegate: the scoping and architecture calls -
Postgres vs. JSON, which checks actually matter, what to cut and in what
order in section 3. Those were decisions I made; the AI implemented them
and I reviewed what came back before accepting it.

**How you verified the output**

Two deterministic checks instead of trusting the model's own numbers: I
recompute subtotal/tax/total from the line items myself, using the same
rounding rule the accounting API uses, and diff against what was
extracted. And I check for duplicates two ways - a database constraint on
my own data, and a live call to the accounting API before registering
anything, so a stale local database can't cause a duplicate registration.

Beyond that, I ran the full pipeline against all 12 real invoices multiple
times over the course of building this, and checked the output against my
own manual read of each invoice image - not just the totals, the actual
line items, dates, and supplier names. I also deliberately tried to break
things to see if the checks would actually catch what they're supposed to:
reset an already-registered invoice back to "unregistered" in my own
database to see if the live dedupe check would catch it (it did), and ran
the pipeline with a wrong accounting-API key to confirm it fails cleanly
instead of hanging or doing something undefined (it does).

**A case where the AI got it wrong**

Honestly, extraction itself never got a value wrong across all 12
invoices, including the deliberately tricky ones - handwriting, a
duplicate pair, mixed tax rates on one invoice, an unusual date format.
That surprised me a bit. The closer thing to "got it wrong" here is a
planning mistake rather than a model mistake: I'd assumed duplicate
detection was cleanly a later pipeline stage, checked right before
registration. The first real run instead crashed with a database
constraint violation, because assigning a partner code to an invoice is
what actually completes the (partner, invoice number) pair that constraint
protects - so the duplicate case surfaces one stage earlier than I'd
planned for. That's not something I'd have caught by reading the plan back
over - only running it against real data showed it.

## 6. Integrating with the accounting system

| Invoice | Result | How you handled it |
|---|---|---|
| invoice_01.pdf | NEEDS_REVIEW | Every line is missing a required `unit` field - genuinely blank on the source PDF, not a reading error. Held for review rather than guessing a unit. |
| invoice_02.pdf | NEEDS_REVIEW | Same issue as invoice_01, across all 26 line items. |
| invoice_03.pdf | NEEDS_REVIEW | One line (a delivery fee) is missing its unit; the rest of the invoice is otherwise clean. |
| invoice_04.jpg | REGISTERED (ACC-0001) | Passed every check, registered cleanly. |
| invoice_05.jpg | REGISTERED (ACC-0002) | Passed every check, registered cleanly. |
| invoice_06.jpg | REGISTERED (ACC-0003) | Supplier name on the invoice is an alias, not the legal name - matched correctly against the partner master's alias list. |
| invoice_07.jpg | SKIPPED_DUPLICATE | Same invoice number and supplier as invoice_01 (a re-scan of the same invoice). Never reached the API - caught before registration. |
| invoice_08.jpg | NEEDS_REVIEW | Has a handwritten "urgent" stamp and a handwritten correction to the bank account number. Both were flagged by the model itself during extraction (`extractionNotes`) - I initially let this register anyway since neither flagged field affects what the accounting system needs, but added a check that holds any invoice with model-flagged uncertainty for review regardless, and this is exactly the invoice that check exists for: a human correction to payment details shouldn't sail through just because the arithmetic checks out. |
| invoice_09.pdf | NEEDS_REVIEW | Printed total is ¥1 off from what the line items actually add up to. Caught by my own recompute check before the API ever saw it. |
| invoice_10.jpg | NEEDS_REVIEW | Supplier isn't in the partner master at all. Flagged rather than guessing the closest match. |
| invoice_11.jpg | REGISTERED (ACC-0005) | Date printed in the Japanese Reiwa era format, converted correctly. |
| invoice_12.jpg | REGISTERED (ACC-0004) | Has a negative line item (a discount). Flowed through extraction, verification, and registration correctly with no special-casing needed. |

Every invoice ends the pipeline in exactly one status - `REGISTERED`,
`NEEDS_REVIEW`, `SKIPPED_DUPLICATE`, or a `FAILED_*` status matching the
API's own error codes. Nothing silently disappears, and nothing gets
registered on a guess.

## 7. Cost, limits, and risk in production

- **Cost per invoice:** I need to correct something I originally assumed
  here. I wrote in my planning notes that Gemini's free tier had "generous
  quota" - while doing final testing for this submission, I hit a real
  `429 Too Many Requests` and found out the actual limit: **20 requests
  per day, per project, per model**, on the free tier. That's not enough
  to reliably process even this 12-invoice sample once in a day if any
  file needs a retry (and I hit real transient failures during testing
  that needed exactly that). So the honest answer is: the free tier is a
  prototyping tool, not a running cost - at any real volume you're on the
  paid tier from day one, not "eventually once you scale." I don't have a
  reliable per-invoice number for the paid tier to quote here - model
  pricing moves fast enough that the model I planned around
  (`gemini-2.0-flash`) was deprecated before I finished building this, so
  I'd check current pricing at deploy time rather than trust a number I
  wrote days earlier.
- **Monthly cost at 1,000 invoices per month:** ~33/day blows past the
  free tier's 20/day cap immediately, so this requires the paid tier from
  the start, not as a later scaling decision. Beyond the API bill, the
  real cost driver is still probably human time reviewing `NEEDS_REVIEW`
  invoices - on this sample, 6 of 12 needed review and 1 more was a
  correctly-caught duplicate (so 5 of 12 auto-registered), but that's a
  deliberately adversarial sample built to hit edge cases; a real supplier
  base is probably cleaner. Even at 10-15% needing a few minutes of review
  each, that likely dwarfs the LLM bill either way.
- **Processing time per invoice:** a few seconds per Gemini call on a good
  run, plus negligible time for the rest of the pipeline. But this isn't
  reliably fast - see below.
- **Where this breaks first:** two different things, both witnessed
  directly while testing, not hypothetical. First, and more fundamental
  than I expected: the free tier's daily quota (20 requests/day/model) is
  the actual first wall this hits, not some later scaling concern - I
  ran into it myself finishing this submission. Second, there's no retry
  or backoff, and transient failures are real: I hit a network error and
  four consecutive `503 Service Unavailable` ("high demand") responses on
  one file before it went through, in addition to the quota wall. Right
  now any of this means rerunning the batch by hand; at real volume this
  needs actual retry/backoff and a paid tier, not a person noticing it
  failed and trying again tomorrow.
- **How you would find out if something was registered incorrectly:**
  every invoice's full history - what the model extracted, what got
  normalized, what the checks said, what the API returned - lives on one
  database row. You'd query that row directly, not reconstruct anything
  from logs.

## 8. What you would do with another 8 hours

1. A minimal review screen for `NEEDS_REVIEW` invoices. Right now it's a
   database row or a JSON export, which works but isn't something an
   accounting person could actually use day to day. This is the biggest
   gap between "the pipeline works" and "the client's staff could run
   this themselves," which is the actual point of the request.
2. Retries, backoff, and a real queue - only matters if this needs to run
   closer to real time instead of as a batch, but worth having before any
   real production volume.
3. Per-field confidence from the model itself, instead of my two blunt
   checks (recompute + dedupe). Would let an invoice with one uncertain
   field get flagged precisely instead of sending the whole invoice to
   review over one line.

In that order because #1 is the difference between a working pipeline and
something the client's own staff could actually use - which is the whole
point of the original request.
