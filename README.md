# trusted-invoice-intake

Reads Japanese supplier invoices (PDF or scanned image), extracts structured
data with an LLM, checks it against itself and the partner master before
trusting it, and registers what passes into the accounting system's API.
Anything that doesn't pass a check gets held for human review instead of
guessed at.

See `CHECKLIST.md` for what's actually been built and verified, and
`SUBMISSION.md` for the full writeup.

## Prerequisites

- Docker + Docker Compose
- A Gemini API key (free tier is enough) — get one at
  [aistudio.google.com](https://aistudio.google.com), no card required in
  most regions

## Setup

```bash
cp .env.example .env
# then edit .env and set GEMINI_API_KEY=<your key>
```

## Run it

```bash
docker compose up --build
```

That's the single command. It starts:

- `postgres` — the pipeline's own database (audit trail, dedupe state)
- `accounting-api` — the mock accounting system from `TAKE_HOME.md`, unmodified
- `app` — runs Prisma migrations, then the full pipeline against every file
  in `invoices/`, then prints a report

Output shows up in the `app` container's logs: a per-invoice line as each
pipeline stage runs, then a final summary and detail table. A full JSON
export of every invoice's final state is written to `data/report.json` on
the host (bind-mounted out of the container isn't set up, so grab it with
`docker compose cp app:/app/data/report.json ./data/report.json` if you
want a copy — or just read the console output, which has everything).

## Starting over

The pipeline is idempotent - rerunning `docker compose up` again is safe,
already-processed invoices are skipped. To fully reset:

```bash
docker compose down -v   # wipes the postgres volume (our pipeline's state)
curl -X DELETE -H "X-API-Key: demo-key-1234" http://localhost:8080/invoices
                          # wipes the accounting API's in-memory state
```

## Local dev (outside Docker)

```bash
npm install
npm run lint
npm run typecheck
npm run dev        # requires postgres + accounting-api already running,
                    # e.g. `docker compose up -d postgres accounting-api`
```

## Environment variables (`.env`)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `GEMINI_API_KEY` | Your Gemini API key — required, no default |
| `ACCOUNTING_API_URL` | Base URL of the accounting API |
| `ACCOUNTING_API_KEY` | API key for the accounting API (the fixed demo key from `TAKE_HOME.md`) |

## CI

GitHub Actions runs on every push: lint, typecheck, `prisma validate`, a
diff of `accounting_api.py` against the code block in `TAKE_HOME.md` (fails
if that file is ever edited, since the brief says it can't change), and a
`docker compose build` check.
