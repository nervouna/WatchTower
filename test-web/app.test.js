import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWatchTowerApp } from "../public/app.js";

const item = {
  entityId: "entity-1",
  rank: 1,
  title: "一条值得关注的产品信号",
  summary: "这是用于验证连续阅读布局的摘要。",
  whyItMatters: "它改变了开发者采用这类工具的成本结构。",
  continuity: { kind: "new" },
  tags: ["AI", "开发工具"],
  sources: [{ source: "github", label: "GitHub", url: "https://github.com/example/project" }],
};

const brief = {
  date: "2026-07-19",
  generatedAt: "2026-07-19T00:12:00Z",
  status: "complete",
  headline: "技术世界今天发生了什么",
  intro: "五条值得投入注意力的产品与技术变化。",
  sourceCounts: { github: 1, "hacker-news": 1 },
  features: { exploration: true },
  audio: { status: "ready", url: "/audio.mp3", transcript: "逐字稿", durationSeconds: 90 },
  items: [item],
};

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function installShell(path = "/") {
  document.body.innerHTML = `
    <header><a data-nav="latest" href="/">今日</a><a data-nav="archive" href="/archive">归档</a>
      <button id="account-button" type="button">账号</button></header>
    <main id="main"><div id="app" aria-busy="true"></div></main>
    <dialog id="account-dialog"><p id="account-copy"></p><p id="account-user-id"></p>
      <p id="account-error"></p><button data-dialog-close>关闭</button><button id="login-button">使用 Apple 登录</button>
      <button id="copy-user-id">复制 user ID</button><button id="logout-button">退出登录</button>
      <section id="danger-zone"><button id="delete-account-button">删除账号</button></section></dialog>`;
  window.history.replaceState({}, "", path);
}

function makeApp(fetchImpl, auth0) {
  return createWatchTowerApp({ document, window, fetch: fetchImpl, auth0 });
}

describe("WatchTower web application", () => {
  beforeEach(() => installShell());

  it("renders a latest brief as one editorial ordered list with local status regions", async () => {
    const fetch = vi.fn(async (url) => {
      if (url === "/api/briefs/latest") return json(brief);
      if (url === "/api/auth/config") return json({ error: { message: "offline" } }, 503);
      throw new Error(`Unexpected ${url}`);
    });
    await makeApp(fetch).start();

    expect(document.querySelector("h1")?.textContent).toBe(brief.headline);
    expect(document.querySelectorAll("ol.brief-list > li")).toHaveLength(1);
    expect(document.querySelector(".brief-item-heading")?.textContent).toContain("01");
    expect(document.querySelector("#app")?.hasAttribute("aria-live")).toBe(false);
    expect(document.querySelector(".exploration-status")?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector("audio")?.getAttribute("controls")).not.toBeNull();
    expect(document.querySelector(".podcast-cover")).toBeNull();
    expect(document.body.textContent).toContain("为什么值得看");
  });

  it("keeps public content readable when Auth0 initialization fails", async () => {
    const fetch = vi.fn(async (url) => url === "/api/briefs/latest" ? json(brief) : json({}, 503));
    await makeApp(fetch).start();
    expect(document.querySelector("h1")?.textContent).toBe(brief.headline);
    expect(document.querySelector("#account-button")).not.toBeNull();
  });

  it("keeps public content readable when authenticated feedback loading fails", async () => {
    const client = {
      isAuthenticated: vi.fn(async () => true),
      getTokenSilently: vi.fn(async () => "token"),
      logout: vi.fn(async () => {}),
    };
    const fetch = vi.fn(async (url) => {
      if (url === "/api/briefs/latest") return json(brief);
      if (url === "/api/auth/config") return json({ issuer: "https://tenant.invalid/", audience: "api", clientIds: { web: "web" } });
      if (url === "/api/auth/me") return json({ user: { id: "auth0|1" }, capabilities: { feedback: true, audioRetry: false } });
      if (String(url).startsWith("/api/feedback?")) return json({ error: { message: "offline" } }, 503);
      throw new Error(`Unexpected ${url}`);
    });
    const app = makeApp(fetch, { createAuth0Client: vi.fn(async () => client) });
    await app.start();
    await app.initializeAuth();
    expect(document.querySelector("h1")?.textContent).toBe(brief.headline);
    expect(document.querySelector("ol.brief-list")).not.toBeNull();
  });

  it("renders loading, empty, API failure, and not-found states with one next step", async () => {
    let resolveBrief;
    const pending = new Promise((resolve) => { resolveBrief = resolve; });
    const app = makeApp(async (url) => url === "/api/briefs/latest" ? pending : json({}, 503));
    const running = app.start();
    expect(document.body.textContent).toContain("正在加载简报");
    resolveBrief(json({ ...brief, items: [] }));
    await running;
    expect(document.body.textContent).toContain("本期暂无可发布热点");
    expect(document.querySelector('a[href="/archive"]')).not.toBeNull();

    installShell("/missing");
    await makeApp(async () => json({}, 503)).start();
    expect(document.body.textContent).toContain("页面不存在");

    installShell();
    await makeApp(async (url) => url === "/api/briefs/latest" ? json({ error: { message: "boom" } }, 500) : json({}, 503)).start();
    expect(document.body.textContent).toContain("暂时无法加载");
  });

  it("renders archive as a grouped index without status labels", async () => {
    installShell("/archive");
    const summaries = [
      { date: "2026-07-19", status: "complete", itemCount: 5 },
      { date: "2026-07-18", status: "partial", itemCount: 3 },
    ];
    await makeApp(async (url) => url.startsWith("/api/briefs?") ? json({ briefs: summaries, nextCursor: null }) : json({}, 503)).start();
    expect(document.querySelectorAll(".archive-row")).toHaveLength(2);
    expect(document.querySelector(".archive-row")?.tagName).toBe("A");
    expect(document.body.textContent).not.toContain("完整");
    expect(document.body.textContent).not.toContain("部分资料");
  });

  it("renders privacy as one article with four standard sections", async () => {
    installShell("/privacy");
    await makeApp(async () => json({}, 503)).start();
    expect(document.querySelector("article.privacy-article")).not.toBeNull();
    expect(document.querySelectorAll("article.privacy-article section")).toHaveLength(4);
    expect(document.body.textContent).not.toContain("PRIVACY");
  });

  it.each([
    ["pending", "语音版正在生成"],
    ["failed", "语音版暂时不可用"],
  ])("renders audio %s without hiding the brief", async (status, copy) => {
    const payload = { ...brief, audio: { status } };
    await makeApp(async (url) => url === "/api/briefs/latest" ? json(payload) : json({}, 503)).start();
    expect(document.body.textContent).toContain(copy);
    expect(document.querySelector("h1")?.textContent).toBe(brief.headline);
  });

  it("expands exploration with accessible loading and error text", async () => {
    const fetch = vi.fn(async (url) => {
      if (url === "/api/briefs/latest") return json(brief);
      if (String(url).startsWith("/api/explorations/")) return json({ error: { message: "未完成" } }, 500);
      return json({}, 503);
    });
    await makeApp(fetch).start();
    const trigger = document.querySelector(".exploration-trigger");
    trigger.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("未完成"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders a ready exploration as typographic sections with source links", async () => {
    const exploration = {
      status: "ready",
      quality: "complete",
      sources: [{ id: "source_1", title: "Primary source", domain: "example.com", url: "https://example.com/source" }],
      sections: {
        overview: { text: "展开说明正文", sourceIds: ["source_1"] },
        relatedProducts: [],
        perspectives: [],
        industry: null,
        watchNext: [],
      },
    };
    const fetch = vi.fn(async (url) => {
      if (url === "/api/briefs/latest") return json(brief);
      if (String(url).startsWith("/api/explorations/")) return json(exploration);
      return json({}, 503);
    });
    await makeApp(fetch).start();
    document.querySelector(".exploration-trigger").click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("展开说明正文"));
    expect(document.querySelectorAll(".exploration-section")).toHaveLength(6);
    expect(document.querySelector(".exploration-source-link")?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders feedback controls for an allowed user and confirms account deletion", async () => {
    const client = {
      isAuthenticated: vi.fn(async () => true),
      getTokenSilently: vi.fn(async () => "token"),
      logout: vi.fn(async () => {}),
    };
    const auth0 = { createAuth0Client: vi.fn(async () => client) };
    window.confirm = vi.fn(() => true);
    const fetch = vi.fn(async (url, options = {}) => {
      if (url === "/api/briefs/latest") return json(brief);
      if (url === "/api/auth/config") return json({ issuer: "https://tenant.invalid/", audience: "api", clientIds: { web: "web" } });
      if (url === "/api/auth/me") return json({ user: { id: "auth0|1" }, capabilities: { feedback: true, audioRetry: true } });
      if (String(url).startsWith("/api/feedback?")) return json({ feedback: {} });
      if (url === "/api/auth/account" && options.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected ${url}`);
    });
    const app = makeApp(fetch, auth0);
    await app.start();
    await app.initializeAuth();
    expect(document.querySelectorAll(".feedback-option")).toHaveLength(3);
    document.querySelector("#account-button").click();
    document.querySelector("#delete-account-button").click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/account", expect.objectContaining({ method: "DELETE" })));
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it("uses safe attributes for every external source link", async () => {
    await makeApp(async (url) => url === "/api/briefs/latest" ? json(brief) : json({}, 503)).start();
    const source = document.querySelector("a.source-link");
    expect(source.getAttribute("target")).toBe("_blank");
    expect(source.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("retries one token refresh after a protected 401 and revokes capability on 403", async () => {
    const client = {
      isAuthenticated: vi.fn(async () => true),
      getTokenSilently: vi.fn(async () => "token"),
      logout: vi.fn(async () => {}),
    };
    let feedbackWrites = 0;
    const fetch = vi.fn(async (url, options = {}) => {
      if (url === "/api/briefs/latest") return json(brief);
      if (url === "/api/auth/config") return json({ issuer: "https://tenant.invalid/", audience: "api", clientIds: { web: "web" } });
      if (url === "/api/auth/me") return json({ user: { id: "auth0|1" }, capabilities: { feedback: true, audioRetry: false } });
      if (String(url).startsWith("/api/feedback?")) return json({ feedback: {} });
      if (String(url).startsWith("/api/feedback/") && options.method === "PUT") {
        feedbackWrites += 1;
        if (feedbackWrites === 1) return json({ error: { message: "expired" } }, 401);
        if (feedbackWrites === 3) return json({ error: { message: "revoked" } }, 403);
        return new Response(null, { status: 204 });
      }
      return json({}, 503);
    });
    const app = makeApp(fetch, { createAuth0Client: vi.fn(async () => client) });
    await app.start();
    await app.initializeAuth();
    const [follow, irrelevant] = document.querySelectorAll(".feedback-option");
    follow.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("已记录"));
    expect(client.getTokenSilently).toHaveBeenCalledWith({ cacheMode: "off" });
    irrelevant.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("当前账号已无反馈权限"));
    expect(document.querySelector("#account-button")?.textContent).toBe("账号");
  });
});
