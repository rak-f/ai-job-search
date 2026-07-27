// Data source: the Firecrawl v2 REST API (https://docs.firecrawl.dev).
// `search` discovers postings anywhere on the web (optionally scoped to job-board
// domains); `scrape` reads one posting. Unlike the HTML-scraping portals there is
// no per-portal markup to parse — Firecrawl returns the structured fields — so this
// skill works for any job board in any market without a parser to maintain.
//
// Zero runtime dependencies: plain `fetch` against the REST API, no SDK.
// Requires FIRECRAWL_API_KEY. FIRECRAWL_API_URL swaps in a self-hosted instance.

export const DEFAULT_API_URL = "https://api.firecrawl.dev"

/** API base URL: FIRECRAWL_API_URL (for a self-hosted instance) or the default. */
export function baseUrl(): string {
  const raw = (process.env.FIRECRAWL_API_URL ?? "").trim()
  return (raw || DEFAULT_API_URL).replace(/\/+$/, "")
}

/** The API key, or null when unset — callers turn that into a NO_API_KEY error. */
export function apiKey(): string | null {
  const raw = (process.env.FIRECRAWL_API_KEY ?? "").trim()
  return raw || null
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "firecrawl-search-skill/1.0 (+https://docs.firecrawl.dev)"

/** Firecrawl's response envelope: {success, data, creditsUsed, id, error}. */
export interface Envelope<T> {
  success: boolean
  data?: T
  creditsUsed?: number
  id?: string
  error?: string
  details?: unknown
}

/**
 * POST a JSON payload to the Firecrawl API. Retries 429/5xx (rate limits and
 * transient server states) with exponential backoff plus jitter; a connection
 * failure fails fast with a clear message, so an outage degrades this source
 * rather than hanging the caller.
 */
export async function apiPost<T>(path: string, payload: unknown): Promise<Envelope<T>> {
  const key = apiKey()
  if (!key) {
    throw new Error(
      "FIRECRAWL_API_KEY is not set — get a key at https://firecrawl.dev and export it, " +
        "or point FIRECRAWL_API_URL at a self-hosted instance",
    )
  }
  const url = `${baseUrl()}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": UA,
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        // Enrichment scrapes each result, so a search can legitimately take a
        // while; the timeout is generous but still bounded.
        signal: AbortSignal.timeout(180000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the Firecrawl API at ${baseUrl()} (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Firecrawl API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    const body = (await response.json().catch(() => null)) as Envelope<T> | null
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        body?.error || "Firecrawl rejected the API key (check FIRECRAWL_API_KEY)",
      )
    }
    if (!response.ok || body?.success === false) {
      // Validation errors carry a `details` array that names the offending field;
      // surfacing it turns "Invalid request body" into something actionable.
      const detail = body?.details ? ` (${JSON.stringify(body.details)})` : ""
      throw new Error(
        (body?.error || `Firecrawl API request failed: ${response.status} ${response.statusText}`) + detail,
      )
    }
    if (!body) throw new Error("Firecrawl API returned an unparseable response body")
    return body
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("Firecrawl API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * The job fields Firecrawl extracts from each posting page. This replaces the
 * per-portal HTML parsing the scraping skills need: the same schema works on any
 * board, so there are no markup anchors to break when a site is redesigned.
 */
export const JOB_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string", description: "The hiring company or organisation name" },
    location: { type: "string", description: "Work location as written on the posting" },
    date_posted: { type: "string", description: "Publication date, ISO YYYY-MM-DD when stated" },
    employment_type: { type: "string", description: "e.g. full-time, part-time, contract" },
    deadline: { type: "string", description: "Application deadline, ISO YYYY-MM-DD when stated" },
  },
} as const

export const JOB_PROMPT =
  "Extract the job posting's hiring company, work location, publication date, employment type " +
  "and application deadline. Use an empty string for anything the page does not state."

/** The extracted job fields; every one may be absent or empty on a given page. */
export interface ExtractedJob {
  company?: string
  location?: string
  date_posted?: string
  employment_type?: string
  deadline?: string
}

/**
 * One `data.web[]` item. Without `scrapeOptions` these are plain search results
 * with top-level url/title/description; with it they are Documents that also
 * carry `metadata` (where url/title are mirrored) and the extracted `json`. The
 * union is why every read below falls back across both shapes.
 */
export interface SearchItem {
  url?: string
  title?: string
  description?: string
  position?: number
  json?: ExtractedJob | null
  metadata?: {
    sourceURL?: string
    url?: string
    title?: string
    description?: string
    statusCode?: number
  }
}

/** A scraped document, as returned by /v2/scrape. */
export interface ScrapedDoc {
  markdown?: string
  json?: ExtractedJob | null
  metadata?: {
    sourceURL?: string
    url?: string
    title?: string
    description?: string
    statusCode?: number
  }
}

/** A search result in the portal-skill contract shape; missing values are null. */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  snippet: string | null
}

/** A job detail: the search result plus the posting text and extra fields. */
export interface JobDetailResult extends JobResult {
  employment_type: string | null
  deadline: string | null
  description: string | null
}

/** Trim, collapse whitespace, and treat an empty result as absent. */
function clean(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.replace(/\s+/g, " ").trim()
  return text || null
}

/**
 * Best-effort posting date. An ISO-prefixed value is normalised to YYYY-MM-DD;
 * anything else the page stated (e.g. "3 days ago") is kept verbatim rather than
 * guessed at, because a wrong date is worse than an unparsed one.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  const text = clean(raw)
  if (!text) return null
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/)
  return iso ? iso[1] : text
}

/**
 * Reshape one search item into the contract's result fields. Returns null when no
 * URL could be resolved from either shape — an unusable result is dropped rather
 * than emitted with a placeholder.
 */
export function toResult(item: SearchItem): JobResult | null {
  const url = clean(item.url) ?? clean(item.metadata?.sourceURL) ?? clean(item.metadata?.url)
  if (!url) return null
  const extracted = item.json ?? {}
  return {
    id: url,
    title: clean(item.title) ?? clean(item.metadata?.title) ?? "(untitled)",
    company: clean(extracted.company),
    location: clean(extracted.location),
    date: normalizeDate(extracted.date_posted),
    url,
    snippet: clean(item.description) ?? clean(item.metadata?.description),
  }
}

/** Reshape a scraped document into the detail result. */
export function toDetail(doc: ScrapedDoc, requestedUrl: string): JobDetailResult {
  const extracted = doc.json ?? {}
  const url = clean(doc.metadata?.sourceURL) ?? clean(doc.metadata?.url) ?? requestedUrl
  return {
    id: url,
    title: clean(doc.metadata?.title) ?? "(untitled)",
    company: clean(extracted.company),
    location: clean(extracted.location),
    date: normalizeDate(extracted.date_posted),
    url,
    snippet: clean(doc.metadata?.description),
    employment_type: clean(extracted.employment_type),
    deadline: normalizeDate(extracted.deadline),
    description: doc.markdown?.trim() || null,
  }
}

/**
 * Firecrawl's `tbs` recency filter is bucketed (hour/day/week/month/year), not an
 * exact day count, so `--jobage` maps to the smallest bucket that still covers the
 * requested window — it never excludes a posting the user asked to see. Returns
 * null when no filter applies (unset, or wider than a year).
 */
export function jobageToTbs(days: number | undefined): string | null {
  if (days === undefined || !Number.isFinite(days) || days <= 0) return null
  if (days <= 1) return "qdr:d"
  if (days <= 7) return "qdr:w"
  if (days <= 31) return "qdr:m"
  if (days <= 366) return "qdr:y"
  return null
}

/**
 * Reduce a user-supplied site to the bare hostname Firecrawl's domain filters
 * expect: no scheme, no path, no leading "www.".
 */
export function normalizeDomain(input: string): string | null {
  const text = input
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase()
  return text || null
}

/** Firecrawl search returns at most 100 results per query. */
export const MAX_SEARCH_RESULTS = 100
