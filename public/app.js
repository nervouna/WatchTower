const app = document.querySelector("#app");
const feedbackModeButton = document.querySelector("#feedback-mode-button");
const feedbackDialog = document.querySelector("#feedback-dialog");
const feedbackAccountCopy = document.querySelector("#feedback-account-copy");
const feedbackUserId = document.querySelector("#feedback-user-id");
const feedbackAuthError = document.querySelector("#feedback-auth-error");
const loginButton = document.querySelector("#login-button");
const logoutButton = document.querySelector("#logout-button");
const deleteAccountButton = document.querySelector("#delete-account-button");
const copyUserIdButton = document.querySelector("#copy-user-id");

let authClient = null;
let authUser = null;
let capabilities = { feedback: false, audioRetry: false };
let authInitializationError = null;

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

async function explorationApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Accept: "application/json", ...options.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || "本次探索未完成，可稍后重试"), {
      status: response.status,
      code: payload?.error?.code,
      retryAfter: response.headers.get("Retry-After"),
    });
  }
  return payload;
}

async function feedbackApi(path, options = {}, retried = false) {
  if (!authClient || !authUser) throw Object.assign(new Error("请先登录。"), { status: 401 });
  const token = await authClient.getTokenSilently();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !retried) {
      try {
        await authClient.getTokenSilently({ cacheMode: "off" });
      } catch {
        await logout(false);
        throw Object.assign(new Error("登录已失效，请重新登录。"), { status: 401 });
      }
      return feedbackApi(path, options, true);
    }
    if (response.status === 403) {
      capabilities = { feedback: false, audioRetry: false };
      updateFeedbackModeButton();
    }
    throw Object.assign(new Error(payload?.error?.message || "请求失败"), { status: response.status });
  }
  return payload;
}

function updateFeedbackModeButton() {
  feedbackModeButton.textContent = capabilities.feedback ? "反馈模式已开启" : authUser ? "账号" : "反馈模式";
  feedbackModeButton.setAttribute("aria-pressed", String(capabilities.feedback));
}

function openFeedbackDialog(message = "") {
  feedbackAuthError.textContent = message;
  feedbackAuthError.hidden = !message;
  const signedIn = Boolean(authUser);
  feedbackUserId.hidden = !signedIn;
  feedbackUserId.textContent = signedIn ? `user ID：${authUser.id}` : "";
  loginButton.hidden = signedIn;
  logoutButton.hidden = !signedIn;
  deleteAccountButton.hidden = !signedIn;
  copyUserIdButton.hidden = !signedIn;
  feedbackAccountCopy.textContent = authInitializationError
    ? "登录服务暂不可用，匿名阅读不受影响。"
    : capabilities.feedback
      ? "你的账号已进入反馈模式，可以跨设备共享反馈并重试失败语音。"
      : signedIn
        ? "当前账号未加入白名单。你仍可阅读，并可复制 user ID 交给管理员。"
        : "使用 Apple 登录后可查看账号状态。阅读始终无需登录。";
  feedbackDialog.showModal();
  (signedIn ? copyUserIdButton : loginButton).focus();
}

async function loadFeedback(items) {
  if (!capabilities.feedback || items.length === 0) return {};
  const query = new URLSearchParams();
  for (const item of items) query.append("entityId", item.entityId);
  try {
    return (await feedbackApi(`/api/feedback?${query}`)).feedback;
  } catch (error) {
    if (error.status === 401) {
      await logout(false);
      updateFeedbackModeButton();
      queueMicrotask(() => openFeedbackDialog("登录已失效，请重新登录。"));
      return {};
    }
    if (error.status === 403) {
      capabilities = { feedback: false, audioRetry: false };
      updateFeedbackModeButton();
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
        status.textContent = error.status === 401 ? "登录已失效，请重新登录。" : error.status === 403 ? "当前账号已无反馈权限。" : "保存失败，请重试。";
        if (error.status === 401) {
          void logout(false);
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

function approximateMinutes(seconds) {
  return Math.max(1, Math.round(seconds / 60));
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
  const title = audio.status === "ready"
    ? `约 ${approximateMinutes(audio.durationSeconds)} 分钟听完本期`
    : "AI 语音简报";
  heading.append(element("h2", "audio-title", title), element("span", "audio-ai-label", "AI 语音，由小米 MiMo 合成"));
  content.append(heading);
  if (audio.status === "pending") {
    content.append(element("p", "audio-state-copy", "语音版正在生成，稍后刷新。文字简报可以正常阅读。"));
    layout.append(content);
    section.append(layout);
    return section;
  }
  if (audio.status === "failed") {
    content.append(element("p", "audio-state-copy", "语音版暂时不可用，文字简报不受影响。"));
    if (capabilities.audioRetry) {
      const retry = element("button", "dialog-button dialog-button-secondary", "重新生成语音");
      retry.type = "button";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "正在提交…";
        try {
          await feedbackApi(`/api/briefs/${brief.date}/audio/retry`, { method: "POST" });
          retry.textContent = "语音正在重新生成";
        } catch {
          retry.disabled = false;
          retry.textContent = "提交失败，请重试";
        }
      });
      content.append(retry);
    }
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

function citationLinks(sourceIds, catalog) {
  const wrapper = element("span", "exploration-citations");
  for (const sourceId of sourceIds) {
    const source = catalog.get(sourceId);
    if (!source) continue;
    const node = link(source.url, sourceId.replace("source_", ""), "exploration-citation");
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.setAttribute("aria-label", `资料来源：${source.title}`);
    wrapper.append(node);
  }
  return wrapper;
}

function citedParagraph(value, catalog, className = "exploration-copy") {
  const paragraph = element("p", className);
  paragraph.append(document.createTextNode(value.text), citationLinks(value.sourceIds, catalog));
  return paragraph;
}

function renderExplorationResult(panel, payload) {
  const catalog = new Map((payload.sources ?? []).map((source) => [source.id, source]));
  const content = element("div", "exploration-content");
  const state = element("div", "exploration-result-meta");
  if (payload.quality === "partial") state.append(element("span", "exploration-quality", "部分资料"));
  if (payload.stale) state.append(element("span", "exploration-stale", payload.refreshing ? "旧结果 · 正在更新" : "旧结果"));
  if (payload.refreshLimited) state.append(element("span", "exploration-stale", "今日刷新额度已用完"));
  if (state.childElementCount) content.append(state);

  const sections = payload.sections;
  const overview = element("section", "exploration-section");
  overview.append(element("h3", "exploration-heading", "展开说明"), citedParagraph(sections.overview, catalog));
  content.append(overview);

  const related = element("section", "exploration-section");
  related.append(element("h3", "exploration-heading", "相关产品"));
  if (sections.relatedProducts.length === 0) related.append(element("p", "exploration-empty", "现有资料不足以确认相关产品关系。"));
  else {
    const list = element("ul", "exploration-list");
    for (const item of sections.relatedProducts) {
      const row = element("li", "exploration-list-item");
      row.append(element("strong", "exploration-item-title", `${item.name} · ${item.relation}`));
      const copy = element("p", "exploration-copy", item.summary);
      copy.append(citationLinks(item.sourceIds, catalog));
      row.append(copy);
      list.append(row);
    }
    related.append(list);
  }
  content.append(related);

  const perspectives = element("section", "exploration-section");
  perspectives.append(element("h3", "exploration-heading", "外部观点"));
  if (sections.perspectives.length === 0) perspectives.append(element("p", "exploration-empty", "暂未找到足够可靠的外部观点。"));
  else {
    const list = element("ul", "exploration-list");
    for (const item of sections.perspectives) {
      const row = element("li", "exploration-list-item");
      row.append(element("strong", "exploration-item-title", item.label));
      const copy = element("p", "exploration-copy", item.summary);
      copy.append(citationLinks(item.sourceIds, catalog));
      row.append(copy);
      list.append(row);
    }
    perspectives.append(list);
  }
  content.append(perspectives);

  const industry = element("section", "exploration-section");
  industry.append(element("h3", "exploration-heading", "行业位置"));
  industry.append(sections.industry ? citedParagraph(sections.industry, catalog) : element("p", "exploration-empty", "现有资料不足以判断行业位置。"));
  content.append(industry);

  const watch = element("section", "exploration-section");
  watch.append(element("h3", "exploration-heading", "接下来关注什么"));
  if (sections.watchNext.length === 0) watch.append(element("p", "exploration-empty", "暂时没有足够证据支持可验证的后续信号。"));
  else {
    const list = element("ul", "exploration-watch-list");
    for (const item of sections.watchNext) {
      const row = element("li", "exploration-watch-item", item.signal);
      row.append(citationLinks(item.sourceIds, catalog));
      list.append(row);
    }
    watch.append(list);
  }
  content.append(watch);

  const sourceSection = element("section", "exploration-sources");
  sourceSection.append(element("h3", "exploration-heading", "资料来源"));
  const sourceList = element("ol", "exploration-source-list");
  for (const source of payload.sources ?? []) {
    const row = element("li", "exploration-source-item");
    const sourceLink = link(source.url, source.title, "exploration-source-link");
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    row.append(sourceLink, element("span", "exploration-domain", source.domain));
    sourceList.append(row);
  }
  sourceSection.append(sourceList);
  content.append(sourceSection);

  const updated = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString("zh-CN", { timeZone: "UTC", hour12: false }) : "未知时间";
  content.append(element("p", "exploration-disclaimer", `AI 基于公开资料整理，信息可能随时间变化，请以原始来源为准。更新于 ${updated} UTC。`));
  panel.replaceChildren(content);
}

function renderExplorationControl(item, briefDate) {
  const wrapper = element("div", "exploration-wrapper");
  const panelId = `exploration-${item.entityId}`;
  const button = element("button", "exploration-trigger", "拓展阅读");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", panelId);
  const panel = element("div", "exploration-panel");
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  let started = false;

  const showState = (copy, kind = "loading") => {
    const state = element("div", `exploration-state exploration-state-${kind}`);
    state.setAttribute("role", "status");
    if (kind === "loading") state.append(element("span", "exploration-spinner"));
    state.append(element("p", "exploration-state-copy", copy));
    panel.replaceChildren(state);
  };

  const load = async () => {
    const path = `/api/explorations/${briefDate}/${item.entityId}`;
    showState("正在查找背景、相关产品和外部观点…");
    try {
      let payload = await explorationApi(path, { method: "POST" });
      const startedAt = Date.now();
      if (payload.status === "ready" && payload.sections) renderExplorationResult(panel, payload);
      while (payload.status !== "ready" && payload.status !== "failed" && Date.now() - startedAt < 95_000) {
        showState(payload.status === "researching" ? "正在整理找到的资料…" : "正在查找背景、相关产品和外部观点…");
        await new Promise((resolve) => window.setTimeout(resolve, (payload.pollAfterSeconds ?? 3) * 1000));
        payload = await explorationApi(path);
      }
      while (payload.status === "ready" && payload.refreshing && Date.now() - startedAt < 95_000) {
        await new Promise((resolve) => window.setTimeout(resolve, (payload.pollAfterSeconds ?? 3) * 1000));
        payload = await explorationApi(path);
        if (payload.sections) renderExplorationResult(panel, payload);
      }
      if (payload.status === "ready" && payload.sections) renderExplorationResult(panel, payload);
      else showState(payload.status === "failed" ? "本次探索未完成，可稍后重试。" : "探索仍在进行，请稍后重新打开查看。", "error");
    } catch (error) {
      const copy = error.code === "EXPLORATION_BUDGET_EXHAUSTED"
        ? "今日探索额度已用完，请明日再试。"
        : error.message || "本次探索未完成，可稍后重试。";
      showState(copy, "error");
      started = false;
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener("click", () => {
    const expanding = panel.hidden;
    panel.hidden = !expanding;
    button.setAttribute("aria-expanded", String(expanding));
    button.textContent = expanding ? "收起阅读" : "拓展阅读";
    if (expanding && !started) {
      started = true;
      button.disabled = true;
      void load();
    }
  });
  wrapper.append(button, panel);
  return wrapper;
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
    if (brief.features?.exploration === true) sources.append(renderExplorationControl(item, brief.date));
    article.append(sources);
    if (capabilities.feedback) article.append(renderFeedbackControls(item, brief.date, feedback[item.entityId]));
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
    ["账号与反馈", "阅读无需账号。只有在你主动使用 Apple 登录后，WatchTower 才会保存 Auth0 user ID、白名单状态和你最后修改的共享反馈；你可以在账号对话框中删除账号。"],
    ["公开来源与拓展阅读", "简报中的外部链接会在目标网站打开。点击“拓展阅读”会触发服务端检索公开资料，同一热点的结果会匿名共享和缓存；原始 IP 仅由 Cloudflare 临时用于宽松限流，不写入 WatchTower 数据库。"],
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
  openFeedbackDialog();
});

feedbackDialog.querySelector("[data-dialog-cancel]").addEventListener("click", () => feedbackDialog.close());

loginButton.addEventListener("click", async () => {
  if (!authClient) return openFeedbackDialog("登录服务暂不可用，请稍后重试。");
  await authClient.loginWithRedirect({
    authorizationParams: { connection: "apple", ui_locales: "zh-CN" },
    appState: { returnTo: `${location.pathname}${location.search}` },
  });
});

async function logout(redirect = true) {
  const client = authClient;
  authUser = null;
  capabilities = { feedback: false, audioRetry: false };
  updateFeedbackModeButton();
  if (client) await client.logout(redirect ? { logoutParams: { returnTo: location.origin } } : { openUrl: false });
}

logoutButton.addEventListener("click", () => void logout());

copyUserIdButton.addEventListener("click", async () => {
  if (!authUser) return;
  await window.navigator.clipboard.writeText(authUser.id);
  copyUserIdButton.textContent = "已复制";
});

deleteAccountButton.addEventListener("click", async () => {
  if (!window.confirm("确认删除账号？反馈审计中的 user ID 会被清除，此操作无法撤销。")) return;
  deleteAccountButton.disabled = true;
  try {
    await feedbackApi("/api/auth/account", { method: "DELETE" });
    await logout();
  } catch (error) {
    feedbackAuthError.textContent = error.message || "删除失败，请稍后重试。";
    feedbackAuthError.hidden = false;
  } finally {
    deleteAccountButton.disabled = false;
  }
});

async function initializeAuth() {
  try {
    const config = await api("/api/auth/config");
    authClient = await window.auth0.createAuth0Client({
      domain: new window.URL(config.issuer).hostname,
      clientId: config.clientIds.web,
      cacheLocation: "memory",
      authorizationParams: { audience: config.audience, redirect_uri: location.origin },
    });
    if (location.search.includes("code=") && location.search.includes("state=")) {
      const result = await authClient.handleRedirectCallback();
      const requestedReturnTo = typeof result.appState?.returnTo === "string" ? result.appState.returnTo : "/";
      const returnUrl = new window.URL(requestedReturnTo, location.origin);
      const returnTo = returnUrl.origin === location.origin ? `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}` : "/";
      window.history.replaceState({}, document.title, returnTo);
    }
    if (!(await authClient.isAuthenticated())) return;
    const token = await authClient.getTokenSilently();
    const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!response.ok) throw Object.assign(new Error("登录状态验证失败。"), { status: response.status });
    const me = await response.json();
    authUser = me.user;
    capabilities = me.capabilities;
  } catch (error) {
    authInitializationError = error;
    authUser = null;
    capabilities = { feedback: false, audioRetry: false };
  } finally {
    updateFeedbackModeButton();
    void main();
  }
}

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
void initializeAuth();
