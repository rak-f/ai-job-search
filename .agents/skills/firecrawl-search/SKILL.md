---
name: firecrawl-search
version: 1.0.0
description: >
  Use this skill to find job postings on job boards that have no dedicated portal
  skill yet — any board, any country, any language — by searching the live web with
  Firecrawl and reading a posting's full text. It needs no per-portal HTML parser, so
  it is the fallback when a market's board is unsupported, when a shipped portal
  skill has broken on a markup change, or when a posting URL needs to be read in
  full. Requires a FIRECRAWL_API_KEY and is disabled by default. Trigger phrases:
  search the web for jobs, find jobs on <job board>, jobs in <country> without a
  portal skill, read this job posting URL, scrape this job ad, my portal skill is
  broken find jobs anyway.
context: fork
enabled: false # needs FIRECRAWL_API_KEY (a paid, metered API) - set to true once yours is exported
allowed-tools: Bash(bun run .agents/skills/firecrawl-search/cli/src/cli.ts *)
---

# Firecrawl Search Skill

Find job postings anywhere on the web via **[Firecrawl](https://docs.firecrawl.dev)**
and read a single posting in full. Where the other portal skills each target one
board with its own parser, this one targets **the web**: Firecrawl runs the search
and extracts the job fields from each posting page, so a single skill covers any
board in any market and language with **no markup anchors to maintain**.

> This is a country-agnostic worked example of the repo's job-portal-skill pattern,
> like `linkedin-search` and `freehire-search`. Unlike both, it is **not** tied to a
> single site — the board is chosen per query with `--site` — and unlike either, it
> requires an API key.

## ⚠️ Credentialed and metered

Every other portal skill in this repo is credential-free. **This one is not.** It
needs `FIRECRAWL_API_KEY` (get one at [firecrawl.dev](https://firecrawl.dev)), and
each call spends Firecrawl credits. Because of that it ships with
**`enabled: false`**, so `/scrape` skips it until you opt in:

```bash
export FIRECRAWL_API_KEY="fc-..."           # then set enabled: true above
```

Without the key every command exits `1` with a `NO_API_KEY` error on stderr, which
`/scrape` logs and steps over — an unset key degrades this source rather than
breaking a run.

**Credit cost.** A plain search is 1 credit per query. Enriched search (the default)
also scrapes each hit to extract company/location/date, which is what makes the
results usable without a parser — measured at roughly **4-6 credits per result**.
Keep `--limit` small, or pass `--no-enrich` for a cheap URL-and-title sweep.

## ℹ️ Hosted-service dependency

This skill depends on the hosted Firecrawl API. If it is unreachable the CLI fails
gracefully — a non-zero exit with a clear message — so an outage degrades this source
rather than breaking the surrounding workflow. Firecrawl is also self-hostable
([open source](https://github.com/firecrawl/firecrawl)); the skill honors a base-URL
env var, `FIRECRAWL_API_URL` (default `https://api.firecrawl.dev`):

```bash
FIRECRAWL_API_URL=http://localhost:3002 bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "data engineer job"
```

## When to use this skill

- Your market's job board has **no portal skill** and you have not built one with
  `/add-portal` yet
- A shipped portal skill has gone **degraded or broken** on a markup change (see
  `/scrape health`) and you still want coverage of that board today
- You want to sweep **several boards at once** by domain rather than one at a time
- You have a **posting URL** and want its full text, deadline, and employment type

For a board that you search regularly, a dedicated `/add-portal` skill is still the
better tool: it is free, faster, and needs no key. This skill is the generalist.

## Commands

### Search job listings

```bash
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keywords. Google-style operators
  work: `"exact phrase"`, `-exclude`, `inurl:`, `site:`.
- `--site <domains>` — restrict to these boards (comma-separated, repeatable), e.g.
  `--site jobs.lever.co,job-boards.greenhouse.io`. Maps to `includeDomains`.
- `--exclude-site <domains>` — drop these domains instead. **Mutually exclusive**
  with `--site` (the API rejects both; the CLI catches it before spending credits).
- `--country <code>` — ISO-3166 alpha-2 search locale, e.g. `--country DK`. Default `US`.
- `--location <place>` / `-l <place>` — geo-target the results, e.g. `--location "Berlin,Germany"`.
- `--jobage <days>` — posted within N days. See the bucketing caveat in **Notes**.
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page. Default 10; `page × limit` must be ≤ 100.
- `--no-enrich` — skip per-result extraction. Much cheaper and faster, but
  `company`, `location`, and `date` come back `null`.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/firecrawl-search/cli/src/cli.ts detail <url> [--format json|plain]
```

`<url>` is a posting URL — a search result's `id` **is** its URL, so it can be passed
straight through. Returns the posting text as markdown plus the extracted company,
location, posting date, employment type, and application deadline.

## Usage examples

```bash
# Data engineering roles across the big ATS boards, last 30 days
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "data engineer job opening" --site job-boards.greenhouse.io,jobs.lever.co,jobs.ashbyhq.com --jobage 30 --limit 5 --format table

# A market with no portal skill yet: Germany, in German
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "Stellenangebot Datenanalyst bewerben" --country DE --location "Germany" --limit 5 --format table

# Cheap, wide sweep for URLs only (1 credit)
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q '"machine learning engineer" remote apply' --no-enrich --limit 20

# Everything except one noisy aggregator
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "geophysicist vacancy" --exclude-site indeed.com --limit 5 --format table

# Read one posting in full
bun run .agents/skills/firecrawl-search/cli/src/cli.ts detail https://job-boards.greenhouse.io/acme/jobs/123 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing a result's `id` (its URL) to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single posting's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total", "enriched", "credits_used" }, "results": [...] }`;
each result carries at least `id` (the posting URL), `title`, `company`, `location`,
`date`, and `url` (missing values are `null`, never omitted), plus a `snippet`. All
errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Write the query like a job search, not a keyword

This searches **the whole web**, so an unqualified role name finds reference pages
rather than vacancies — `-q "geophysicist"` returns Wikipedia and a careers-advice
page. Two habits fix it, and the CLI deliberately does **not** apply them for you
(it never rewrites your query behind your back):

- **State the intent**: `"geophysicist job opening apply"`, `"Stellenangebot ..."`,
  `"ledige stillinger ..."` — in the market's own language.
- **Scope the domains**: `--site` with the boards you actually want. ATS domains
  (`job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `*.workday.com`)
  resolve to individual postings; large aggregators often rank their **search-results
  pages** instead, so `--site jobindex.dk` can return `/jobsoegning?q=...` listing
  URLs rather than single ads. Add `inurl:` to bias toward posting paths, or prefer a
  dedicated `/add-portal` skill for such a board.

## Notes

- **`--jobage` is bucketed, not exact.** Firecrawl's recency filter has
  hour/day/week/month/year granularity, so `--jobage 14` asks for the **month**
  bucket — the smallest one that still contains everything you asked for. It never
  hides a posting inside your window, but it does return some older than N days;
  filter precisely downstream if that matters.
- **`--page` re-fetches.** Firecrawl search has no offset parameter, so page N is
  served by requesting `page × limit` results and returning the last window. Page 1
  (the common case) fetches exactly what it needs; deeper pages cost proportionally
  more.
- **Extraction is model-based, so treat fields as best-effort.** `company` and
  `location` land reliably on real posting pages; `date` is often absent because many
  boards do not publish one. A `date` the page states in a non-ISO form (e.g.
  "3 days ago") is kept **verbatim** rather than converted to a guessed calendar date.
- `id` in search results is the posting **URL** — pass it as-is to `detail`.
- Results whose URL cannot be resolved are dropped rather than emitted with a
  placeholder.
- The API retries 429/5xx with exponential backoff and jitter; a `401`/`403` fails
  immediately with a key-specific message instead of retrying.
- Endpoints, parameters, and response shapes are documented in `url-reference.md` —
  that is the file to update if the Firecrawl API changes.
