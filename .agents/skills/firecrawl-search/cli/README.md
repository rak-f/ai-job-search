# firecrawl-cli

CLI for finding job postings on **any** job board, in any market and language, via
the [Firecrawl](https://docs.firecrawl.dev) v2 REST API — and for reading a single
posting in full. There is no per-portal HTML parser: Firecrawl extracts the job
fields from each posting page, so nothing here breaks when a board changes its markup.

**Data source**: the Firecrawl v2 REST API (`POST /v2/search`, `POST /v2/scrape`).
**Authentication**: required — `FIRECRAWL_API_KEY` ([get one](https://firecrawl.dev)).
**Dependencies**: zero runtime dependencies (plain `fetch`, no SDK); dev types only.

> **Credentialed and metered.** Unlike the other portal CLIs in this repo, this one
> needs an API key and spends Firecrawl credits: 1 per plain search, plus roughly
> 4-6 per result when enrichment is on (the default). The skill therefore ships
> `enabled: false` so `/scrape` skips it until you opt in. Without a key every
> command exits `1` with a `NO_API_KEY` error on stderr, so an unset key degrades
> this source instead of breaking a run.

## Installation

```bash
cd .agents/skills/firecrawl-search/cli && bun install
```

The install is optional — the CLI has no runtime dependencies and runs with plain
`bun`; `bun install` only pulls TypeScript dev types for `bun run typecheck`.

## Self-hosting / base URL

Firecrawl is [open source](https://github.com/firecrawl/firecrawl). Point the CLI at
your own instance with `FIRECRAWL_API_URL` (default `https://api.firecrawl.dev`):

```bash
FIRECRAWL_API_URL=http://localhost:3002 bun run src/cli.ts search -q "data engineer job"
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search the web for job postings, optionally scoped to given job-board domains |
| `detail <url>` | Scrape one posting: full text as markdown plus the extracted fields |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. A search result's `id` is its URL, so it can be passed
straight to `detail`.

All errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Data engineering roles across the big ATS boards, last 30 days
bun run src/cli.ts search -q "data engineer job opening" --site job-boards.greenhouse.io,jobs.lever.co --jobage 30 --limit 5 --format table

# A market with no portal skill yet: Germany, in German
bun run src/cli.ts search -q "Stellenangebot Datenanalyst bewerben" --country DE --limit 5 --format table

# Cheap, wide sweep for URLs only (1 credit, no company/location/date)
bun run src/cli.ts search -q '"machine learning engineer" remote apply' --no-enrich --limit 20

# Read one posting in full
bun run src/cli.ts detail https://job-boards.greenhouse.io/acme/jobs/123 --format plain
```

See `../SKILL.md` for the full flag reference, the credit-cost breakdown, and query
advice; `../url-reference.md` documents the API shapes this CLI depends on.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query <text>` | `-q` | **Required.** Keywords; supports `""`, `-`, `inurl:`, `intitle:` operators |
| `--site <domains>` | | Restrict to these boards (comma-separated, repeatable) |
| `--exclude-site <domains>` | | Drop these domains; mutually exclusive with `--site` |
| `--country <code>` | | ISO-3166 alpha-2 search locale (default `US`) |
| `--location <place>` | `-l` | Geo-target the results, e.g. `"Berlin,Germany"` |
| `--jobage <days>` | | Posted within N days (bucketed to day/week/month/year) |
| `--page <n>` | | 1-indexed page, default 1 (re-fetches; search has no offset param) |
| `--limit <n>` | `-n` | Results per page, default 10; `page × limit` must be ≤ 100 |
| `--no-enrich` | | Skip per-result extraction: cheap and fast, but no company/location/date |
| `--format <fmt>` | | `json` (default), `table`, or `plain` |

Because this searches the whole web, an unqualified role name finds reference pages
rather than vacancies. State the intent in the query ("... job opening apply", or the
market's own phrasing) and scope `--site` to boards you want; the CLI never rewrites
your query for you. See the query section in `../SKILL.md`.

## Tests

```bash
bun test        # network-free: unit tests plus mocked-fetch command tests
```
