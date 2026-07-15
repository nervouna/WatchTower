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
  if (isLatest && brief.date < utcToday()) {
    const delayed = element("div", "notice notice-delay");
    delayed.setAttribute("role", "status");
    delayed.textContent = `今日简报生成延迟，当前展示 ${brief.date}`;
    fragment.append(delayed);
  }
  if (brief.status === "partial") {
    const partial = element("div", "notice notice-partial");
    partial.textContent = `本期为部分简报，暂缺：${brief.missingSources.map((source) => sourceNames[source]).join("、")}`;
    fragment.append(partial);
  }

  const hero = element("header", "brief-hero");
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
  fragment.append(hero);

  const list = element("ol", "brief-list");
  for (const item of brief.items) {
    const row = element("li", "brief-item");
    const article = element("article", "brief-card");
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
  fragment.append(list);
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
  section.append(element("p", "eyebrow", "ARCHIVE"), element("h1", "brief-title", "历史归档"));
  if (summaries.length === 0) {
    section.append(element("p", "state-copy", "归档仍为空，第一期简报发布后会出现在这里。"));
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
      section.append(group);
    }
  }
  app.replaceChildren(section);
}

async function main() {
  try {
    if (location.pathname === "/archive" || location.pathname === "/archive/") return await renderArchive();
    const match = /^\/briefs\/(\d{4}-\d{2}-\d{2})\/?$/.exec(location.pathname);
    if (match) return renderBrief(await api(`/api/briefs/${match[1]}`), false);
    if (location.pathname !== "/") return renderError("页面不存在", "没有找到你访问的页面。");
    return renderBrief(await api("/api/briefs/latest"), true);
  } catch (error) {
    if (error.status === 404) renderError("简报尚未发布", error.message);
    else renderError("暂时无法加载", "请稍后刷新页面重试。");
  }
}

void main();
