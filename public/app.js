const app = document.querySelector("#app");

const sourceNames = {
  "hacker-news": "Hacker News",
  "product-hunt": "Product Hunt",
  github: "GitHub",
  kickstarter: "Kickstarter",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href, text, className) {
  const node = element("a", className, text);
  node.href = href;
  return node;
}

function externalLink(source) {
  const node = link(source.url, source.label, `source source-${source.source}`);
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "请求失败"), { status: response.status });
  return payload;
}

function renderError(title, message) {
  const section = element("section", "state-card");
  section.append(element("p", "eyebrow", "WATCHTOWER"), element("h1", "state-title", title), element("p", "state-copy", message));
  section.append(link("/", "返回最新简报", "button-link"));
  app.replaceChildren(section);
}

function renderBrief(brief, isLatest) {
  document.title = `${brief.date} · WatchTower 热点简报`;
  const fragment = document.createDocumentFragment();
  const notices = [];
  if (isLatest && brief.date < utcToday()) {
    const delayed = element("div", "notice notice-delay");
    delayed.setAttribute("role", "status");
    delayed.textContent = `今日简报生成延迟，当前展示 ${brief.date}`;
    notices.push(delayed);
  }
  if (brief.status === "partial") {
    const partial = element("div", "notice notice-partial");
    partial.setAttribute("role", "status");
    partial.textContent = `本期为部分简报，暂缺：${brief.missingSources.map((source) => sourceNames[source]).join("、")}`;
    notices.push(partial);
  }

  const hero = element("header", "brief-hero hero-card");
  hero.append(element("p", "eyebrow", `${brief.date} · UTC`), element("h1", "brief-title", brief.headline), element("p", "brief-intro", brief.intro));
  const metadata = element("div", "metadata");
  metadata.append(
    element("span", `status status-${brief.status}`, brief.status === "complete" ? "完整" : "部分"),
    element("span", "meta-item", `生成于 ${new Date(brief.generatedAt).toLocaleString("zh-CN", { timeZone: "UTC" })} UTC`),
    element("span", "meta-item", `${brief.items.length} 条热点`),
  );
  hero.append(metadata);
  const coverage = element("dl", "coverage");
  for (const [source, name] of Object.entries(sourceNames)) {
    const item = element("div", "coverage-item");
    item.append(element("dt", "coverage-source", name), element("dd", "coverage-count", `${brief.sourceCounts[source] ?? 0} 条`));
    coverage.append(item);
  }
  hero.append(coverage);
  hero.append(...notices);
  fragment.append(hero);

  const briefSection = element("section", "brief-section surface-card");
  const sectionHeader = element("header", "section-header");
  sectionHeader.append(element("h2", "section-title", "本期热点"), element("p", "section-meta", `${brief.items.length} 条经过筛选的技术与产品信号`));
  briefSection.append(sectionHeader);
  if (brief.items.length === 0) {
    const empty = element("div", "brief-empty");
    empty.append(element("h3", "section-title", "本期暂无可发布热点"), element("p", "state-copy", "当前信号还不足以形成可靠简报，你可以回看已经发布的内容。"));
    empty.append(link("/archive", "查看历史简报", "button-link"));
    briefSection.append(empty);
    fragment.append(briefSection);
    app.replaceChildren(fragment);
    return;
  }
  const list = element("ol", "brief-list");
  for (const item of brief.items) {
    const row = element("li", "brief-item");
    const article = element("article", "brief-entry");
    const heading = element("h2", "item-title");
    heading.append(element("span", "rank", String(item.rank).padStart(2, "0")), document.createTextNode(item.title));
    article.append(heading, element("p", "summary", item.summary));
    const why = element("div", "why");
    why.append(element("h3", "why-title", "为什么值得看"), element("p", "why-copy", item.whyItMatters));
    article.append(why);
    if (item.continuity.kind === "continuing") {
      const continuity = element("div", "continuity");
      continuity.append(element("strong", "", "持续关注："), document.createTextNode(item.continuity.materialChange + " "));
      continuity.append(link(`/briefs/${item.continuity.previousDate}`, `查看 ${item.continuity.previousDate} 简报`));
      article.append(continuity);
    }
    const tags = element("ul", "tags");
    for (const tag of item.tags) tags.append(element("li", "tag", tag));
    article.append(tags);
    const sources = element("div", "sources");
    sources.append(element("span", "sources-label", "来源"));
    for (const source of item.sources) sources.append(externalLink(source));
    article.append(sources);
    row.append(article);
    list.append(row);
  }
  briefSection.append(list);
  fragment.append(briefSection);
  app.replaceChildren(fragment);
}

async function renderArchive() {
  document.title = "历史归档 · WatchTower 热点简报";
  const summaries = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await api(`/api/briefs?${query}`);
    summaries.push(...page.briefs);
    cursor = page.nextCursor;
  } while (cursor);
  const section = element("section", "archive");
  const hero = element("header", "archive-hero hero-card");
  hero.append(element("p", "eyebrow", "ARCHIVE"), element("h1", "brief-title", "历史归档"), element("p", "brief-intro", "按日期回看每一期技术与产品热点简报。"));
  if (summaries.length > 0) hero.append(element("p", "archive-total", `已归档 ${summaries.length} 期`));
  section.append(hero);
  const archiveCard = element("div", "archive-card surface-card");
  if (summaries.length === 0) {
    const empty = element("div", "archive-empty");
    empty.append(element("h2", "section-title", "第一期简报正在路上"), element("p", "state-copy", "发布后会自动出现在这里，你可以先查看最新简报。"));
    empty.append(link("/", "查看最新简报", "button-link"));
    archiveCard.append(empty);
  } else {
    const groups = Map.groupBy(summaries, (brief) => brief.date.slice(0, 7));
    for (const [month, briefs] of groups) {
      const group = element("section", "archive-month");
      group.append(element("h2", "archive-month-title", month));
      const list = element("ul", "archive-list");
      for (const brief of briefs) {
        const row = element("li", "archive-row");
        row.append(link(`/briefs/${brief.date}`, brief.date, "archive-date"));
        row.append(element("span", `status status-${brief.status}`, brief.status === "complete" ? "完整" : "部分"));
        row.append(element("span", "archive-count", `${brief.itemCount} 条`));
        list.append(row);
      }
      group.append(list);
      archiveCard.append(group);
    }
  }
  section.append(archiveCard);
  app.replaceChildren(section);
}

function markCurrentNavigation() {
  const isArchive = location.pathname === "/archive" || location.pathname === "/archive/";
  const latest = document.querySelector('[data-nav="latest"]');
  const archive = document.querySelector('[data-nav="archive"]');
  if (isArchive) {
    latest?.removeAttribute("aria-current");
    archive?.setAttribute("aria-current", "page");
  } else {
    latest?.setAttribute("aria-current", "page");
    archive?.removeAttribute("aria-current");
  }
}

async function main() {
  try {
    markCurrentNavigation();
    if (location.pathname === "/archive" || location.pathname === "/archive/") return await renderArchive();
    const match = /^\/briefs\/(\d{4}-\d{2}-\d{2})\/?$/.exec(location.pathname);
    if (match) return renderBrief(await api(`/api/briefs/${match[1]}`), false);
    if (location.pathname !== "/") return renderError("页面不存在", "没有找到你访问的页面。");
    return renderBrief(await api("/api/briefs/latest"), true);
  } catch (error) {
    if (error.status === 404) renderError("简报尚未发布", error.message);
    else renderError("暂时无法加载", "请稍后刷新页面重试。");
  } finally {
    app.setAttribute("aria-busy", "false");
  }
}

void main();
