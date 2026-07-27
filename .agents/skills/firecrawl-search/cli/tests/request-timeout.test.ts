import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apiPost } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request wrapper
// carries an AbortSignal timeout and authenticates with a bearer token.
const originalFetch = globalThis.fetch;
const originalKey = process.env.FIRECRAWL_API_KEY;

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalKey;
});

describe("apiPost request", () => {
  test("passes an AbortSignal timeout and a bearer token to fetch", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await apiPost("/v2/search", { query: "test" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fc-test-key");
  });

  test("throws a key-specific error on 401 rather than retrying", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(apiPost("/v2/search", { query: "test" })).rejects.toThrow("Unauthorized");
    expect(calls).toBe(1);
  });
});
