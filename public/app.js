const app = document.querySelector("#app");
const feedbackModeButton = document.querySelector("#feedback-mode-button");
const feedbackDialog = document.querySelector("#feedback-dialog");
const feedbackForm = document.querySelector("#feedback-form");
const feedbackTokenInput = document.querySelector("#feedback-token");
const feedbackAuthError = document.querySelector("#feedback-auth-error");
const feedbackSessionKey = "watchtower-feedback-token";

let feedbackToken = sessionStorage.getItem(feedbackSessionKey);

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

async function feedbackApi(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${feedbackToken ?? ""}`);
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || "请求失败"), { status: response.status });
  }
  return payload;
}

function updateFeedbackModeButton() {
  feedbackModeButton.textContent = feedbackToken ? "退出反馈模式" : "反馈模式";
  feedbackModeButton.setAttribute("aria-pressed", feedbackToken ? "true" : "false");
}

function openFeedbackDialog(message = "") {
  feedbackAuthError.textContent = message;
  feedbackAuthError.hidden = !message;
  feedbackTokenInput.value = "";
  feedbackDialog.showModal();
  feedbackTokenInput.focus();
}

async function loadFeedback(items) {
  if (!feedbackToken || items.length === 0) return {};
  const query = new URLSearchParams();
  for (const item of items) query.append("entityId", item.entityId);
  try {
    return (await feedbackApi(`/api/feedback?${query}`)).feedback;
  } catch (error) {
    if (error.status === 401) {
      feedbackToken = null;
      sessionStorage.removeItem(feedbackSessionKey);
      updateFeedbackModeButton();
      queueMicrotask(() => openFeedbackDialog("凭证已失效，请重新输入。"));
      return {};
    }
    throw error;
  }
}

function renderFeedbackControls(item, briefDate, initialValue) {
  const wrapper = element("div", "feedback-controls");
  const label = element("span", "feedback-label", "指导后续筛选");
  const group = element("div", "feedback-options");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `反馈：${item.title}`);
  const status = element("span", "feedback-status");
  status.setAttribute("aria-live", "polite");
  let currentValue = initialValue ?? null;
  let saving = false;
  const choices = [
    ["follow", "持续关注"],
    ["irrelevant", "不相关"],
    ["uninteresting", "没意思"],
  ];
  const buttons = choices.map(([value, text]) => {
    const button = element("button", "feedback-option", text);
    button.type = "button";
    button.dataset.value = value;
    button.setAttribute("aria-pressed", String(currentValue === value));
    group.append(button);
    return button;
  });

  function paint(value) {
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.value === value));
  }

  for (const button of buttons) {
    button.addEventListener("click", async () => {
      if (saving) return;
      const previousValue = currentValue;
      const nextValue = currentValue === button.dataset.value ? null : button.dataset.value;
      saving = true;
      currentValue = nextValue;
      paint(nextValue);
      for (const option of buttons) option.disabled = true;
      status.className = "feedback-status is-saving";
      status.textContent = "正在保存…";
      try {
        if (nextValue) {
          await feedbackApi(`/api/feedback/${item.entityId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: nextValue, briefDate }),
          });
        } else {
          await feedbackApi(`/api/feedback/${item.entityId}`, { method: "DELETE" });
        }
        status.className = "feedback-status is-saved";
        status.textContent = nextValue ? "已记录，将用于后续筛选。" : "已清除反馈。";
      } catch (error) {
        currentValue = previousValue;
        paint(previousValue);
        status.className = "feedback-status is-error";
        status.textContent = error.status === 401 ? "凭证已失效，请重新解锁。" : "保存失败，请重试。";
        if (error.status === 401) {
          feedbackToken = null;
          sessionStorage.removeItem(feedbackSessionKey);
          updateFeedbackModeButton();
          window.setTimeout(() => void main().then(() => openFeedbackDialog("凭证已失效，请重新输入。")), 0);
        }
      } finally {
        saving = false;
        for (const option of buttons) option.disabled = false;
      }
    });
  }
  wrapper.append(label, group, status);
  return wrapper;
}

function renderError(title, message) {
  const section = element("section", "state-card");
  section.append(element("p", "eyebrow", "WATCHTOWER"), element("h1", "state-title", title), element("p", "state-copy", message));
  section.append(link("/", "返回最新简报", "button-link"));
  app.replaceChildren(section);
}

function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)} 分 ${String(rounded % 60).padStart(2, "0")} 秒`;
}

function renderPodcastCover(cover, brief) {
  const wrapper = element("div", `podcast-cover podcast-cover-${cover?.status ?? "missing"}`);
  wrapper.setAttribute("aria-hidden", "true");
  if (cover?.status === "ready") {
    const image = element("img", "podcast-cover-image");
    image.src = cover.url;
    image.alt = "";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.remove();
      wrapper.classList.add("podcast-cover-fallback");
    });
    wrapper.append(image);
  } else {
    wrapper.classList.add("podcast-cover-fallback");
  }
  const overlay = element("div", "podcast-cover-overlay");
  const meta = element("div", "podcast-cover-meta");
  meta.append(element("span", "podcast-cover-brand", "WATCHTOWER DAILY"), element("span", "podcast-cover-date", brief.date));
  overlay.append(meta, element("h3", "podcast-cover-title", brief.headline), element("span", "podcast-cover-format", "每日播客 · AI 语音"));
  wrapper.append(overlay);
  return wrapper;
}

function renderBriefAudio(audio, brief) {
  if (!audio) return null;
  const section = element("section", `brief-audio brief-audio-${audio.status}`);
  section.setAttribute("aria-label", "本期语音简报");
  const layout = element("div", "audio-layout");
  layout.append(renderPodcastCover(audio.cover, brief));
  const content = element("div", "audio-content");
  const heading = element("div", "audio-heading");
  heading.append(element("h2", "audio-title", "约 3 分钟听完本期"), element("span", "audio-ai-label", "AI 语音，由小米 MiMo 合成"));
  content.append(heading);
  if (audio.status === "pending") {
    content.append(element("p", "audio-state-copy", "语音版正在生成，稍后刷新。文字简报可以正常阅读。"));
    layout.append(content);
    section.append(layout);
    return section;
  }
  if (audio.status === "failed") {
    content.append(element("p", "audio-state-copy", "语音版暂时不可用，文字简报不受影响。"));
    layout.append(content);
    section.append(layout);
    return section;
  }
  const player = element("audio", "audio-player");
  player.controls = true;
  player.preload = "metadata";
  player.src = audio.url;
  const status = element("p", "audio-meta", `实际时长 ${formatDuration(audio.durationSeconds)}`);
  player.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(player.duration)) status.textContent = `实际时长 ${formatDuration(player.duration)}`;
  });
  player.addEventListener("error", () => {
    player.hidden = true;
    status.className = "audio-state-copy audio-error";
    status.setAttribute("role", "status");
    status.textContent = "音频加载失败，请稍后刷新。文字简报仍可正常阅读。";
  });
  const transcript = element("details", "audio-transcript");
  transcript.append(element("summary", "transcript-summary", "查看逐字稿"), element("p", "transcript-copy", audio.transcript));
  content.append(player, status, transcript);
  layout.append(content);
  section.append(layout);
  return section;
}

async function renderBrief(brief, isLatest) {
  document.title = `${brief.date} · WatchTower 热点简报`;
  const fragment = document.createDocumentFragment();
  const feedback = await loadFeedback(brief.items);
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
  const audio = renderBriefAudio(brief.audio, brief);
  if (audio) hero.append(audio);
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
    if (feedbackToken) article.append(renderFeedbackControls(item, brief.date, feedback[item.entityId]));
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

function renderPrivacy() {
  document.title = "隐私说明 · WatchTower";
  const section = element("section", "archive");
  const hero = element("header", "archive-hero hero-card");
  hero.append(
    element("p", "eyebrow", "PRIVACY"),
    element("h1", "brief-title", "隐私说明"),
    element("p", "brief-intro", "WatchTower 无需账号即可阅读，不包含广告或跨应用追踪。"),
  );
  section.append(hero);
  const card = element("article", "archive-card surface-card");
  const blocks = [
    ["本地阅读数据", "你阅读过哪些简报、音频播放位置和离线缓存只保存在当前设备，不会上传到 WatchTower。"],
    ["发布通知", "只有在你主动开启移动 App 的每日提醒后，App 才会把 APNs 设备令牌加密发送给 WatchTower。令牌只用于发送新简报通知；关闭提醒后，服务端会删除对应订阅。"],
    ["公开来源", "简报中的外部链接会在目标网站打开，并适用目标网站各自的隐私政策。"],
  ];
  for (const [title, copy] of blocks) {
    const block = element("section", "archive-month");
    block.append(element("h2", "section-title", title), element("p", "state-copy", copy));
    card.append(block);
  }
  section.append(card);
  app.replaceChildren(section);
}

function markCurrentNavigation() {
  const isArchive = location.pathname === "/archive" || location.pathname === "/archive/";
  const isPrivacy = location.pathname === "/privacy" || location.pathname === "/privacy/";
  const latest = document.querySelector('[data-nav="latest"]');
  const archive = document.querySelector('[data-nav="archive"]');
  if (isArchive) {
    latest?.removeAttribute("aria-current");
    archive?.setAttribute("aria-current", "page");
  } else if (isPrivacy) {
    latest?.removeAttribute("aria-current");
    archive?.removeAttribute("aria-current");
  } else {
    latest?.setAttribute("aria-current", "page");
    archive?.removeAttribute("aria-current");
  }
}

feedbackModeButton.addEventListener("click", () => {
  if (feedbackToken) {
    feedbackToken = null;
    sessionStorage.removeItem(feedbackSessionKey);
    updateFeedbackModeButton();
    void main();
    return;
  }
  openFeedbackDialog();
});

feedbackDialog.querySelector("[data-dialog-cancel]").addEventListener("click", () => feedbackDialog.close());

feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submittedToken = feedbackTokenInput.value;
  const submitButton = feedbackForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  feedbackAuthError.hidden = true;
  feedbackToken = submittedToken;
  try {
    await feedbackApi("/api/feedback");
    sessionStorage.setItem(feedbackSessionKey, submittedToken);
    feedbackDialog.close();
    updateFeedbackModeButton();
    await main();
  } catch (error) {
    feedbackToken = null;
    sessionStorage.removeItem(feedbackSessionKey);
    feedbackAuthError.textContent = error.status === 401 ? "凭证不正确，请重试。" : "暂时无法验证，请稍后重试。";
    feedbackAuthError.hidden = false;
    feedbackTokenInput.select();
  } finally {
    submitButton.disabled = false;
  }
});

async function main() {
  try {
    markCurrentNavigation();
    if (location.pathname === "/privacy" || location.pathname === "/privacy/") return renderPrivacy();
    if (location.pathname === "/archive" || location.pathname === "/archive/") return await renderArchive();
    const match = /^\/briefs\/(\d{4}-\d{2}-\d{2})\/?$/.exec(location.pathname);
    if (match) return await renderBrief(await api(`/api/briefs/${match[1]}`), false);
    if (location.pathname !== "/") return renderError("页面不存在", "没有找到你访问的页面。");
    return await renderBrief(await api("/api/briefs/latest"), true);
  } catch (error) {
    if (error.status === 404) renderError("简报尚未发布", error.message);
    else renderError("暂时无法加载", "请稍后刷新页面重试。");
  } finally {
    app.setAttribute("aria-busy", "false");
  }
}

updateFeedbackModeButton();
void main();
