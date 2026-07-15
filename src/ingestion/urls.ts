import type { SourceKind } from "../domain/types";

const TRACKING_PARAMETERS = new Set(["ref", "source", "referrer", "campaign"]);

export interface NormalizedSourceUrl {
  canonicalKey: string;
  url: string;
}

function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname === `www.${domain}`;
}

function removeTracking(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
}

export function normalizeSourceUrl(source: SourceKind, input: string): NormalizedSourceUrl | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  removeTracking(url);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (source === "hacker-news") {
    if (!isHost(url.hostname, "news.ycombinator.com") || url.pathname !== "/item") return null;
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return null;
    return { canonicalKey: `hn:${id}`, url: url.toString() };
  }

  if (source === "product-hunt") {
    if (!isHost(url.hostname, "producthunt.com")) return null;
    const match = /^\/posts\/([^/]+)$/u.exec(url.pathname);
    if (!match?.[1]) return null;
    return { canonicalKey: `ph:${decodeURIComponent(match[1]).toLowerCase()}`, url: url.toString() };
  }

  if (source === "github") {
    if (!isHost(url.hostname, "github.com") || url.search) return null;
    const match = /^\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (!match?.[1] || !match[2]) return null;
    const owner = decodeURIComponent(match[1]);
    const repo = decodeURIComponent(match[2]);
    const reserved = new Set(["trending", "topics", "collections", "features", "marketplace", "login", "signup"]);
    if (reserved.has(owner.toLowerCase())) return null;
    return { canonicalKey: `github:${owner.toLowerCase()}/${repo.toLowerCase()}`, url: url.toString() };
  }

  if (!isHost(url.hostname, "kickstarter.com") || url.search) return null;
  const match = /^\/projects\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    canonicalKey: `kickstarter:${decodeURIComponent(match[1]).toLowerCase()}/${decodeURIComponent(match[2]).toLowerCase()}`,
    url: url.toString(),
  };
}

export function findHackerNewsOriginalUrl(extractedEvidence: string): string | null {
  const matches = extractedEvidence.match(/https:\/\/[^\s<>()\]"']+/gu) ?? [];
  for (const raw of matches) {
    const candidate = raw.replace(/[.,;:!?]+$/u, "");
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && !isHost(url.hostname.toLowerCase(), "news.ycombinator.com")) return url.toString();
    } catch {
      // Ignore malformed evidence links.
    }
  }
  return null;
}
