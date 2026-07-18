import { describe, expect, it, vi } from "vitest";

import {
  buildCoverPrompt,
  COVER_PROMPT_MAX_CHARS,
  COVER_PROMPT_TARGET_CHARS,
  COVER_PROMPT_VERSION,
  FalProviderError,
  generateCoverImage,
  type FalRequestTracking,
} from "../src/cover/fal";
import type { BriefPayload } from "../src/domain/types";

const brief = {
  date: "2026-07-17",
  status: "complete",
  publishedAt: "2026-07-17T00:00:00.000Z",
  generatedAt: "2026-07-16T23:30:00.000Z",
  headline: "开源工具与新型硬件正在重塑产品开发",
  intro: "今天值得关注的信号集中在开发工具、AI 基础设施与小型硬件团队。",
  missingSources: [],
  sourceCounts: { "hacker-news": 1, "product-hunt": 1, github: 1, kickstarter: 1 },
  audio: null,
  items: [
    {
      rank: 1,
      entityId: "entity_1",
      title: "新的开发工具",
      summary: "摘要",
      whyItMatters: "原因",
      tags: ["开发工具", "AI"],
      continuity: { kind: "new" },
      sources: [],
    },
  ],
} satisfies BriefPayload;

function webp(): ArrayBuffer {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]).buffer;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

const tracking = {
  requestId: "existing-request",
  statusUrl: "https://queue.fal.run/fal-ai/recraft/requests/existing-request/status",
  responseUrl: "https://queue.fal.run/fal-ai/recraft/requests/existing-request/response",
};

describe("fal podcast cover generation", () => {
  it("builds a brand-constrained prompt without asking the model to render text", () => {
    const prompt = buildCoverPrompt(brief);
    expect(prompt).toContain(brief.headline);
    expect(prompt).toContain("Radar Cyan");
    expect(prompt).toContain("no words, letters, numbers, logos, or watermarks");
    expect(prompt).toContain("negative space");
    expect(COVER_PROMPT_VERSION).toBe("podcast-cover-v2-bounded");
    expect(codePointLength(prompt)).toBeLessThanOrEqual(COVER_PROMPT_TARGET_CHARS);
  });

  it("keeps long Chinese brief context within the fal prompt budget without splitting Unicode", () => {
    const longBrief: BriefPayload = {
      ...brief,
      headline: `AI 代理与开源模型正在改变开发流程 ${"新信号😀".repeat(40)}`,
      intro: `本期聚焦开发工具、模型基础设施与产品发现。${"值得持续关注😀".repeat(80)}`,
      items: Array.from({ length: 5 }, (_, index) => ({
        ...brief.items[0]!,
        rank: index + 1,
        entityId: `entity_${String(index + 1)}`,
        title: `排名${String(index + 1)}热点 ${"开源工具😀".repeat(30)}`,
        tags: ["开发工具😀", "人工智能", "产品趋势"],
      })),
    };

    const prompt = buildCoverPrompt(longBrief);

    expect(codePointLength(prompt)).toBeLessThanOrEqual(COVER_PROMPT_TARGET_CHARS);
    expect(prompt).toContain("AI 代理与开源模型正在改变开发流程");
    expect(prompt).toContain("排名1热点");
    expect(prompt).toContain("Radar Cyan (#0E7490)");
    expect(prompt).toContain("negative space");
    expect(prompt).toContain("no words, letters, numbers, logos, or watermarks");
    expect(prompt).not.toContain("�");
  });

  it("rejects an oversized prompt before submitting to fal", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(generateCoverImage("secret", "😀".repeat(COVER_PROMPT_MAX_CHARS + 1), { fetcher }))
      .rejects.toMatchObject({ message: "FAL_PROMPT_TOO_LONG", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps an asynchronous fal prompt validation response to a terminal safe error", async () => {
    const rejectedPrompt = "sensitive prompt content";
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({
        detail: [{
          type: "string_too_long",
          loc: ["body", "prompt"],
          msg: "String should have at most 1000 characters",
          input: rejectedPrompt,
          ctx: { max_length: 1000 },
        }],
      }, { status: 422 }));

    const error = await generateCoverImage("secret", "valid prompt", { request: tracking, fetcher, pollIntervalMs: 0 })
      .then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(FalProviderError);
    expect(error).toMatchObject({ message: "FAL_PROMPT_TOO_LONG", status: 422, retryable: false });
    expect(String(error)).not.toContain(rejectedPrompt);
  });

  it.each([
    [400, false],
    [408, true],
    [429, true],
    [500, true],
  ])("classifies fal submit HTTP %i retryability", async (status, retryable) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("provider error", { status }));
    await expect(generateCoverImage("secret", "valid prompt", { fetcher }))
      .rejects.toMatchObject({ message: `FAL_SUBMIT_FAILED_HTTP_${String(status)}`, status, retryable });
  });

  it("bounds untrusted fal error bodies and keeps only the stable HTTP code", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ detail: [{ input: "x".repeat(40_000) }] }, { status: 422 }));

    await expect(generateCoverImage("secret", "valid prompt", { request: tracking, fetcher, pollIntervalMs: 0 }))
      .rejects.toMatchObject({ message: "FAL_RESULT_FAILED_HTTP_422", status: 422, retryable: false });
  });

  it("submits to the durable queue, persists the request id, and downloads a validated image", async () => {
    const submitted = vi.fn<(request: FalRequestTracking) => Promise<void>>().mockResolvedValue();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        request_id: "request-1",
        status_url: "https://queue.fal.run/fal-ai/recraft/requests/request-1/status",
        response_url: "https://queue.fal.run/fal-ai/recraft/requests/request-1/response",
      }))
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: "https://fal.media/files/cover.webp", content_type: "image/webp" }] }))
      .mockResolvedValueOnce(new Response(webp(), { headers: { "Content-Type": "image/webp", "Content-Length": String(webp().byteLength) } }));

    const result = await generateCoverImage("secret", buildCoverPrompt(brief), {
      fetcher,
      onSubmitted: submitted,
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({ requestId: "request-1", contentType: "image/webp" });
    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array(webp()));
    expect(submitted).toHaveBeenCalledWith({
      requestId: "request-1",
      statusUrl: "https://queue.fal.run/fal-ai/recraft/requests/request-1/status",
      responseUrl: "https://queue.fal.run/fal-ai/recraft/requests/request-1/response",
    });
    const [submitUrl, submitInit] = fetcher.mock.calls[0]!;
    expect(String(submitUrl)).toBe("https://queue.fal.run/fal-ai/recraft/v3/text-to-image");
    expect(new Headers(submitInit?.headers).get("Authorization")).toBe("Key secret");
    expect(JSON.parse(String(submitInit?.body))).toMatchObject({
      image_size: "square_hd",
      style: "digital_illustration/cover",
      enable_safety_checker: true,
      colors: [{ r: 14, g: 116, b: 144 }],
    });
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("resumes an existing fal request without submitting a second paid generation", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: "https://v3.fal.media/files/cover.webp" }] }))
      .mockResolvedValueOnce(new Response(webp(), { headers: { "Content-Type": "image/webp" } }));

    const result = await generateCoverImage("secret", "prompt", {
      request: tracking,
      fetcher,
      pollIntervalMs: 0,
    });

    expect(result.requestId).toBe("existing-request");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]![0])).toBe(tracking.statusUrl);
  });

  it("rejects an untrusted persisted tracking URL before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(generateCoverImage("secret", "prompt", {
      request: { ...tracking, statusUrl: "https://example.com/status" },
      fetcher,
    })).rejects.toThrow("FAL_UNTRUSTED_TRACKING_URL");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["untrusted media host", "https://example.com/cover.webp", "FAL_UNTRUSTED_MEDIA_URL"],
    ["non-https media URL", "http://fal.media/files/cover.webp", "FAL_UNTRUSTED_MEDIA_URL"],
  ])("rejects %s", async (_name, url, code) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url }] }));
    await expect(generateCoverImage("secret", "prompt", { request: tracking, fetcher, pollIntervalMs: 0 })).rejects.toThrow(code);
  });

  it("rejects invalid image bytes", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: "https://fal.media/files/cover.webp" }] }))
      .mockResolvedValueOnce(new Response("not an image", { headers: { "Content-Type": "image/webp" } }));
    await expect(generateCoverImage("secret", "prompt", { request: tracking, fetcher, pollIntervalMs: 0 })).rejects.toThrow("FAL_INVALID_IMAGE");
  });
});
