import { describe, expect, it, vi } from "vitest";

import { ExternalApiError, fetchJsonWithRetry } from "../src/ingestion/http-client";

describe("fetchJsonWithRetry", () => {
  it("retries 429 and caps Retry-After at thirty seconds", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "90" } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn(async () => undefined);

    const result = await fetchJsonWithRetry<{ ok: boolean }>("https://example.com", {}, { fetcher, sleep, random: () => 0 });

    expect(result.data).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("retries network errors at most twice", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    await expect(
      fetchJsonWithRetry("https://example.com", {}, { fetcher, sleep: async () => undefined, random: () => 0 }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", attempts: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retriable 4xx responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(fetchJsonWithRetry("https://example.com", {}, { fetcher })).rejects.toBeInstanceOf(ExternalApiError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
