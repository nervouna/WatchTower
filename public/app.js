const SOURCE_NAMES = {
  "hacker-news": "Hacker News",
  "product-hunt": "Product Hunt",
  github: "GitHub",
  kickstarter: "Kickstarter",
};

const DEFAULT_CAPABILITIES = Object.freeze({ feedback: false, audioRetry: false });

export function createWatchTowerApp(dependencies) {
  const document = dependencies.document;
  const window = dependencies.window;
  const fetch = dependencies.fetch;
  const auth0 = dependencies.auth0;
  const app = document.querySelector("#app");
  const accountButton = document.querySelector("#account-button");
  const accountDialog = document.querySelector("#account-dialog");
  const accountCopy = document.querySelector("#account-copy");
  const accountUserId = document.querySelector("#account-user-id");
  const accountError = document.querySelector("#account-error");
  const loginButton = document.querySelector("#login-button");
  const logoutButton = document.querySelector("#logout-button");
  const copyUserIdButton = document.querySelector("#copy-user-id");
  const deleteAccountButton = document.querySelector("#delete-account-button");
  const dangerZone = document.querySelector("#danger-zone");

  if (!app) throw new Error("WatchTower requires an #app root.");

  let authClient = null;
  let authUser = null;
  let capabilities = { ...DEFAULT_CAPABILITIES };
  let authInitializationError = null;

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

  function externalLink(href, text, className = "source-link") {
    const node = link(href, text, className);
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
  }

  function replaceApp(...nodes) {
    app.replaceChildren(...nodes);
    app.setAttribute("aria-busy", "false");
  }

  async function api(path, options = {}) {
    const headers = new window.Headers(options.headers);
    headers.set("Accept", "application/json");
    const response = await fetch(path, { ...options, headers });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(payload?.error?.message || "请求失败"), {
        status: response.status,
        code: payload?.error?.code,
        retryAfter: response.headers.get("Retry-After"),
      });
    }
    return payload;
  }

  async function protectedApi(path, options = {}, retried = false) {
    if (!authClient || !authUser) throw Object.assign(new Error("请先登录。"), { status: 401 });
    const token = await authClient.getTokenSilently();
    const headers = new window.Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    try {
      return await api(path, { ...options, headers });
    } catch (error) {
      if (error.status === 401 && !retried) {
        try {
          await authClient.getTokenSilently({ cacheMode: "off" });
        } catch {
          await logout(false);
          throw Object.assign(new Error("登录已失效，请重新登录。"), { status: 401 });
        }
        return protectedApi(path, options, true);
      }
      if (error.status === 403) {
        capabilities = { ...DEFAULT_CAPABILITIES };
        updateAccountButton();
      }
      throw error;
    }
  }

  function utcToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDuration(seconds) {
    const rounded = Math.max(0, Math.round(seconds || 0));
    return `${Math.floor(rounded / 60)} 分 ${String(rounded % 60).padStart(2, "0")} 秒`;
  }

  function updateAccountButton() {
    if (!accountButton) return;
    accountButton.textContent = capabilities.feedback ? "账号 · 可反馈" : "账号";
    accountButton.setAttribute("aria-haspopup", "dialog");
  }

  function paintAccountDialog(message = "") {
    if (!accountDialog) return;
    const signedIn = Boolean(authUser);
    accountUserId.hidden = !signedIn;
    accountUserId.textContent = signedIn ? `user ID：${authUser.id}` : "";
    loginButton.hidden = signedIn;
    logoutButton.hidden = !signedIn;
    copyUserIdButton.hidden = !signedIn;
    dangerZone.hidden = !signedIn;
    accountError.textContent = message;
    accountError.hidden = !message;
    accountCopy.textContent = authInitializationError
      ? "登录服务暂不可用，匿名阅读、音频和拓展阅读不受影响。"
      : capabilities.feedback
        ? "当前账号可以共享热点反馈，并重试失败的语音简报。"
        : signedIn
          ? "当前账号未获得反馈权限。你仍可使用全部公开阅读功能。"
          : "使用 Apple 登录后可共享反馈。阅读始终无需登录。";
  }

  function openAccountDialog(message = "") {
    if (!accountDialog) return;
    paintAccountDialog(message);
    if (typeof accountDialog.showModal === "function") accountDialog.showModal();
    else accountDialog.setAttribute("open", "");
    (authUser ? copyUserIdButton : loginButton)?.focus();
  }

  async function logout(redirect = true) {
    const client = authClient;
    authUser = null;
    capabilities = { ...DEFAULT_CAPABILITIES };
    updateAccountButton();
    paintAccountDialog();
    if (client) {
      await client.logout(redirect
        ? { logoutParams: { returnTo: window.location.origin } }
        : { openUrl: false });
    }
  }

  function bindAccountControls() {
    accountButton?.addEventListener("click", () => openAccountDialog());
    accountDialog?.querySelector("[data-dialog-close]")?.addEventListener("click", () => accountDialog.close?.());
    loginButton?.addEventListener("click", async () => {
      if (!authClient) return openAccountDialog("登录服务暂不可用，请稍后重试。");
      await authClient.loginWithRedirect({
        authorizationParams: { connection: "apple", ui_locales: "zh-CN" },
        appState: { returnTo: `${window.location.pathname}${window.location.search}` },
      });
    });
    logoutButton?.addEventListener("click", () => void logout());
    copyUserIdButton?.addEventListener("click", async () => {
      if (!authUser) return;
      await window.navigator.clipboard.writeText(authUser.id);
      copyUserIdButton.textContent = "已复制";
    });
    deleteAccountButton?.addEventListener("click", async () => {
      if (!window.confirm("确认删除账号？账号资料和可关联的反馈记录将被清除，此操作无法撤销。")) return;
      deleteAccountButton.disabled = true;
      try {
        await protectedApi("/api/auth/account", { method: "DELETE" });
        await logout();
      } catch (error) {
        paintAccountDialog(error.message || "删除失败，请稍后重试。");
      } finally {
        deleteAccountButton.disabled = false;
      }
    });
  }

  function renderLoading() {
    document.title = "正在加载 · WatchTower";
    app.setAttribute("aria-busy", "true");
    const section = element("section", "page-state page-state-loading");
    section.setAttribute("aria-labelledby", "loading-title");
    const title = element("h1", "", "正在加载简报");
    title.id = "loading-title";
    const skeleton = element("div", "text-skeleton");
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.append(element("span"), element("span"), element("span"));
    section.append(title, element("p", "", "正在获取今天值得关注的技术与产品变化。"), skeleton);
    app.replaceChildren(section);
  }

  function renderPageState(title, message, href, action) {
    document.title = `${title} · WatchTower`;
    const section = element("section", "page-state");
    section.append(element("h1", "", title), element("p", "", message));
    if (href && action) section.append(link(href, action, "action-link"));
    replaceApp(section);
  }

  function sourceCoverage(brief) {
    const values = [];
    for (const [source, name] of Object.entries(SOURCE_NAMES)) {
      const count = brief.sourceCounts?.[source] ?? 0;
      if (count > 0) values.push(`${name} ${count}`);
    }
    return values.join(" / ");
  }

  function renderAudio(audio, brief) {
    if (!audio) return null;
    const section = element("section", `audio-toolbar audio-${audio.status}`);
    section.setAttribute("aria-label", "本期语音简报");
    const label = element("div", "audio-label");
    label.append(element("strong", "", "语音简报"));
    const status = element("span", "audio-meta", audio.status === "ready"
      ? `AI 合成 / ${formatDuration(audio.durationSeconds)}`
      : "AI 合成");
    label.append(status);
    section.append(label);
    const appendRetry = () => {
      if (!capabilities.audioRetry) return;
      const retry = element("button", "control control-secondary", "重新生成语音");
      retry.type = "button";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "正在提交";
        try {
          const result = await protectedApi(`/api/briefs/${brief.date}/audio/retry`, { method: "POST" });
          retry.textContent = result.status === "queued" ? "已提交生成" : "语音仍在生成中";
        } catch {
          retry.disabled = false;
          retry.textContent = "提交失败，请重试";
        }
      });
      section.append(retry);
    };
    if (audio.status === "pending") {
      section.append(element("p", "audio-state", "语音版正在生成，文字简报可以正常阅读。"));
      appendRetry();
      return section;
    }
    if (audio.status === "failed") {
      const state = element("p", "audio-state", "语音版暂时不可用，文字简报不受影响。");
      section.append(state);
      appendRetry();
      return section;
    }
    const player = element("audio", "audio-player");
    player.controls = true;
    player.preload = "metadata";
    player.src = audio.url;
    player.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(player.duration)) status.textContent = `AI 合成 / ${formatDuration(player.duration)}`;
    });
    const playerError = element("p", "audio-state audio-error");
    playerError.hidden = true;
    playerError.setAttribute("role", "status");
    player.addEventListener("error", () => {
      player.hidden = true;
      playerError.hidden = false;
      playerError.textContent = "音频加载失败，请稍后刷新。文字简报仍可正常阅读。";
    });
    const transcript = element("details", "audio-transcript");
    transcript.append(element("summary", "", "查看逐字稿"), element("p", "", audio.transcript || "暂无逐字稿。"));
    section.append(player, playerError, transcript);
    return section;
  }

  async function loadFeedback(items) {
    if (!capabilities.feedback || items.length === 0) return {};
    const query = new window.URLSearchParams();
    for (const item of items) query.append("entityId", item.entityId);
    try {
      return (await protectedApi(`/api/feedback?${query}`)).feedback;
    } catch (error) {
      if (error.status === 401) {
        await logout(false);
        window.queueMicrotask(() => openAccountDialog("登录已失效，请重新登录。"));
        return {};
      }
      if (error.status === 403) return {};
      authInitializationError = error;
      return {};
    }
  }

  function renderFeedbackControls(item, briefDate, initialValue) {
    const section = element("section", "feedback-controls");
    section.setAttribute("aria-label", `这条内容：${item.title}`);
    section.append(element("strong", "feedback-label", "这条内容"));
    const group = element("div", "feedback-options");
    group.setAttribute("role", "group");
    const status = element("span", "feedback-status");
    status.setAttribute("aria-live", "polite");
    let currentValue = initialValue ?? null;
    let saving = false;
    const choices = [["follow", "持续关注"], ["irrelevant", "不相关"], ["uninteresting", "没意思"]];
    const buttons = choices.map(([value, label]) => {
      const button = element("button", "feedback-option", label);
      button.type = "button";
      button.dataset.value = value;
      button.setAttribute("aria-pressed", String(currentValue === value));
      group.append(button);
      return button;
    });
    const paint = (value) => buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.value === value)));
    for (const button of buttons) {
      button.addEventListener("click", async () => {
        if (saving) return;
        const previousValue = currentValue;
        const nextValue = currentValue === button.dataset.value ? null : button.dataset.value;
        saving = true;
        currentValue = nextValue;
        paint(nextValue);
        buttons.forEach((option) => { option.disabled = true; });
        status.textContent = "正在保存…";
        try {
          if (nextValue) {
            await protectedApi(`/api/feedback/${item.entityId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value: nextValue, briefDate }),
            });
          } else {
            await protectedApi(`/api/feedback/${item.entityId}`, { method: "DELETE" });
          }
          status.textContent = nextValue ? "已记录，将用于后续筛选。" : "已清除反馈。";
        } catch (error) {
          currentValue = previousValue;
          paint(previousValue);
          status.className = "feedback-status is-error";
          status.textContent = error.status === 403 ? "当前账号已无反馈权限。" : "保存失败，请重试。";
        } finally {
          saving = false;
          buttons.forEach((option) => { option.disabled = false; });
        }
      });
    }
    section.append(group, status);
    return section;
  }

  function citationLinks(sourceIds, catalog) {
    const wrapper = element("span", "exploration-citations");
    for (const sourceId of sourceIds || []) {
      const source = catalog.get(sourceId);
      if (!source) continue;
      const citation = externalLink(source.url, sourceId.replace("source_", ""), "exploration-citation");
      citation.setAttribute("aria-label", `资料来源：${source.title}`);
      wrapper.append(citation);
    }
    return wrapper;
  }

  function citedParagraph(value, catalog) {
    const paragraph = element("p", "exploration-copy", value?.text || "现有资料不足。");
    paragraph.append(citationLinks(value?.sourceIds, catalog));
    return paragraph;
  }

  function renderExplorationResult(panel, payload) {
    const catalog = new Map((payload.sources || []).map((source) => [source.id, source]));
    const content = element("div", "exploration-content");
    const notes = [];
    if (payload.quality === "partial") notes.push("部分资料");
    if (payload.stale) notes.push(payload.refreshing ? "旧结果，正在更新" : "旧结果");
    if (payload.refreshLimited) notes.push("今日刷新额度已用完");
    if (notes.length) content.append(element("p", "exploration-note", notes.join(" / ")));
    const sections = payload.sections || {};
    const addSection = (title, body) => {
      const section = element("section", "exploration-section");
      section.append(element("h3", "", title), body);
      content.append(section);
    };
    addSection("展开说明", citedParagraph(sections.overview, catalog));
    const related = element("ul", "exploration-list");
    for (const value of sections.relatedProducts || []) {
      const row = element("li");
      row.append(element("strong", "", `${value.name} / ${value.relation}`), citedParagraph({ text: value.summary, sourceIds: value.sourceIds }, catalog));
      related.append(row);
    }
    addSection("相关产品", related.childElementCount ? related : element("p", "exploration-empty", "现有资料不足以确认相关产品关系。"));
    const perspectives = element("ul", "exploration-list");
    for (const value of sections.perspectives || []) {
      const row = element("li");
      row.append(element("strong", "", value.label), citedParagraph({ text: value.summary, sourceIds: value.sourceIds }, catalog));
      perspectives.append(row);
    }
    addSection("外部观点", perspectives.childElementCount ? perspectives : element("p", "exploration-empty", "暂未找到足够可靠的外部观点。"));
    addSection("行业位置", sections.industry ? citedParagraph(sections.industry, catalog) : element("p", "exploration-empty", "现有资料不足以判断行业位置。"));
    const watch = element("ul", "exploration-list");
    for (const value of sections.watchNext || []) {
      const row = element("li", "", value.signal);
      row.append(citationLinks(value.sourceIds, catalog));
      watch.append(row);
    }
    addSection("接下来关注什么", watch.childElementCount ? watch : element("p", "exploration-empty", "暂时没有足够证据支持可验证的后续信号。"));
    const sources = element("ol", "exploration-source-list");
    for (const source of payload.sources || []) {
      const row = element("li");
      row.append(externalLink(source.url, source.title, "exploration-source-link"), element("span", "exploration-domain", source.domain));
      sources.append(row);
    }
    addSection("资料来源", sources);
    content.append(element("p", "exploration-disclaimer", "AI 基于公开资料整理，信息可能随时间变化，请以原始来源为准。"));
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
    const status = element("div", "exploration-status");
    status.setAttribute("aria-live", "polite");
    panel.append(status);
    let started = false;
    const showState = (copy, error = false) => {
      status.className = error ? "exploration-status is-error" : "exploration-status";
      status.textContent = copy;
    };
    const sleep = (seconds) => new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
    const load = async () => {
      const path = `/api/explorations/${briefDate}/${item.entityId}`;
      showState("正在查找背景、相关产品和外部观点…");
      try {
        let payload = await api(path, { method: "POST" });
        const startedAt = Date.now();
        while (!["ready", "failed"].includes(payload.status) && Date.now() - startedAt < 95_000) {
          showState(payload.status === "researching" ? "正在整理找到的资料…" : "正在查找背景、相关产品和外部观点…");
          await sleep(payload.pollAfterSeconds ?? 3);
          payload = await api(path);
        }
        while (payload.status === "ready" && payload.refreshing && Date.now() - startedAt < 95_000) {
          if (payload.sections) renderExplorationResult(panel, payload);
          await sleep(payload.pollAfterSeconds ?? 3);
          payload = await api(path);
        }
        if (payload.status === "ready" && payload.sections) renderExplorationResult(panel, payload);
        else showState(payload.status === "failed" ? "本次探索未完成，可稍后重试。" : "探索仍在进行，请稍后重新打开查看。", true);
      } catch (error) {
        showState(error.code === "EXPLORATION_BUDGET_EXHAUSTED" ? "今日探索额度已用完，请明日再试。" : error.message || "本次探索未完成，可稍后重试。", true);
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

  function issueNavigation(brief) {
    const aside = element("aside", "issue-index");
    aside.setAttribute("aria-label", "本期目录");
    aside.append(element("p", "issue-date", brief.date));
    const nav = element("nav", "issue-links");
    for (const item of brief.items) nav.append(link(`#item-${item.rank}`, String(item.rank).padStart(2, "0")));
    aside.append(nav);
    return aside;
  }

  async function renderBrief(brief, isLatest) {
    document.title = `${brief.date} · WatchTower 热点简报`;
    const feedback = await loadFeedback(brief.items || []);
    const layout = element("div", "brief-layout");
    layout.append(issueNavigation(brief));
    const reading = element("div", "reading-column");
    if (!brief.items?.length) {
      const empty = element("section", "page-state brief-empty-state");
      empty.append(
        element("p", "brief-date", brief.date),
        element("h1", "", "本期暂无可发布热点"),
        element("p", "", "当前信号还不足以形成可靠简报，你可以回看已经发布的内容。"),
        link("/archive", "查看历史简报", "action-link"),
      );
      reading.append(empty);
      layout.append(reading);
      replaceApp(layout);
      return;
    }
    const header = element("header", "brief-header");
    const generated = new Date(brief.generatedAt).toISOString().slice(11, 16);
    header.append(
      element("p", "brief-date", `${brief.date} / 更新 ${generated} UTC`),
      element("h1", "brief-title", brief.headline),
      element("p", "brief-intro", brief.intro),
    );
    if (isLatest && brief.date < utcToday()) {
      const delayed = element("p", "brief-notice", `发布延迟，当前展示 ${brief.date}。`);
      delayed.setAttribute("role", "status");
      header.append(delayed);
    }
    const coverage = sourceCoverage(brief);
    if (coverage) header.append(element("p", "coverage", `来源覆盖 / ${coverage}`));
    const audio = renderAudio(brief.audio, brief);
    if (audio) header.append(audio);
    reading.append(header);

    const list = element("ol", "brief-list");
    for (const item of brief.items) {
      const row = element("li", "brief-item");
      row.id = `item-${item.rank}`;
      const article = element("article", "brief-entry");
      const heading = element("h2", "brief-item-heading");
      heading.append(element("span", "rank", String(item.rank).padStart(2, "0")), document.createTextNode(item.title));
      article.append(heading, element("p", "summary", item.summary));
      const why = element("p", "why-copy");
      why.append(element("strong", "", "为什么值得看："), document.createTextNode(item.whyItMatters));
      article.append(why);
      if (item.continuity?.kind === "continuing") {
        const continuity = element("p", "continuity");
        continuity.append(element("strong", "", "持续关注："), document.createTextNode(`${item.continuity.materialChange} `), link(`/briefs/${item.continuity.previousDate}`, `查看 ${item.continuity.previousDate} 简报`));
        article.append(continuity);
      }
      if (item.tags?.length) article.append(element("p", "metadata", item.tags.join(" / ")));
      const sources = element("div", "source-row");
      sources.append(element("span", "source-label", "来源"));
      for (const source of item.sources || []) sources.append(externalLink(source.url, source.label));
      if (brief.features?.exploration) sources.append(renderExplorationControl(item, brief.date));
      article.append(sources);
      if (capabilities.feedback) article.append(renderFeedbackControls(item, brief.date, feedback[item.entityId]));
      row.append(article);
      list.append(row);
    }
    reading.append(list);
    layout.append(reading);
    replaceApp(layout);
  }

  async function renderArchive() {
    document.title = "归档 · WatchTower 热点简报";
    const summaries = [];
    let cursor = null;
    do {
      const query = new window.URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const page = await api(`/api/briefs?${query}`);
      summaries.push(...page.briefs);
      cursor = page.nextCursor;
    } while (cursor);
    const page = element("section", "archive-page");
    const header = element("header", "section-heading");
    header.append(element("h1", "", "归档"));
    if (summaries.length) header.append(element("p", "", `${summaries.length} 期简报，按发布日期索引。`));
    page.append(header);
    if (!summaries.length) {
      const empty = element("section", "inline-state");
      empty.append(element("h2", "", "第一期简报正在路上"), element("p", "", "发布后会自动出现在这里。"), link("/", "查看今日", "action-link"));
      page.append(empty);
      replaceApp(page);
      return;
    }
    const groups = Map.groupBy(summaries, (brief) => brief.date.slice(0, 7));
    for (const [month, briefs] of groups) {
      const group = element("section", "archive-month");
      group.append(element("h2", "", month));
      const list = element("ul", "archive-list");
      for (const brief of briefs) {
        const row = element("li");
        const rowLink = link(`/briefs/${brief.date}`, "", "archive-row");
        const date = element("span", "archive-date", brief.date);
        const count = element("span", "archive-count", `${brief.itemCount} 条`);
        rowLink.append(date, count);
        row.append(rowLink);
        list.append(row);
      }
      group.append(list);
      page.append(group);
    }
    replaceApp(page);
  }

  function renderPrivacy() {
    document.title = "隐私说明 · WatchTower";
    const article = element("article", "privacy-article");
    const header = element("header", "section-heading");
    header.append(element("h1", "", "隐私说明"), element("p", "", "WatchTower 无需账号即可阅读，不包含广告或跨应用追踪。"));
    article.append(header);
    const blocks = [
      ["本地阅读数据", "你阅读过哪些简报、音频播放位置和离线缓存只保存在当前设备，不会上传到 WatchTower。"],
      ["发布通知", "只有在你主动开启移动 App 的每日提醒后，App 才会把 APNs 设备令牌加密发送给 WatchTower。令牌只用于发送新简报通知；关闭提醒后，服务端会删除对应订阅。"],
      ["账号与反馈", "阅读无需账号。只有在你主动使用 Apple 登录后，WatchTower 才会保存 Auth0 user ID、白名单状态和你最后修改的共享反馈；你可以在账号对话框中删除账号。"],
      ["公开来源与拓展阅读", "简报中的外部链接会在目标网站打开。点击“拓展阅读”会触发服务端检索公开资料，同一热点的结果会匿名共享和缓存；原始 IP 仅由 Cloudflare 临时用于宽松限流，不写入 WatchTower 数据库。"],
    ];
    for (const [title, copy] of blocks) {
      const section = element("section");
      section.append(element("h2", "", title), element("p", "", copy));
      article.append(section);
    }
    replaceApp(article);
  }

  function markCurrentNavigation() {
    const path = window.location.pathname;
    const latest = document.querySelector('[data-nav="latest"]');
    const archive = document.querySelector('[data-nav="archive"]');
    latest?.removeAttribute("aria-current");
    archive?.removeAttribute("aria-current");
    if (path === "/archive" || path === "/archive/") archive?.setAttribute("aria-current", "page");
    else if (path !== "/privacy" && path !== "/privacy/") latest?.setAttribute("aria-current", "page");
  }

  async function renderRoute() {
    markCurrentNavigation();
    const path = window.location.pathname;
    if (path === "/privacy" || path === "/privacy/") return renderPrivacy();
    if (path === "/archive" || path === "/archive/") return renderArchive();
    const match = /^\/briefs\/(\d{4}-\d{2}-\d{2})\/?$/.exec(path);
    if (match) return renderBrief(await api(`/api/briefs/${match[1]}`), false);
    if (path !== "/") return renderPageState("页面不存在", "没有找到你访问的页面。", "/", "返回今日");
    return renderBrief(await api("/api/briefs/latest"), true);
  }

  async function start() {
    renderLoading();
    try {
      await renderRoute();
    } catch (error) {
      if (error.status === 404) renderPageState("简报尚未发布", error.message, "/archive", "查看归档");
      else renderPageState("暂时无法加载", "请稍后刷新页面重试。", window.location.pathname, "重新加载");
    }
  }

  async function initializeAuth() {
    try {
      const config = await api("/api/auth/config");
      if (!auth0?.createAuth0Client) throw new Error("Auth0 SDK unavailable");
      authClient = await auth0.createAuth0Client({
        domain: new window.URL(config.issuer).hostname,
        clientId: config.clientIds.web,
        cacheLocation: "memory",
        authorizationParams: { audience: config.audience, redirect_uri: window.location.origin },
      });
      if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
        const result = await authClient.handleRedirectCallback();
        const requested = typeof result.appState?.returnTo === "string" ? result.appState.returnTo : "/";
        const returnUrl = new window.URL(requested, window.location.origin);
        const returnTo = returnUrl.origin === window.location.origin ? `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}` : "/";
        window.history.replaceState({}, document.title, returnTo);
      }
      if (!(await authClient.isAuthenticated())) return;
      const token = await authClient.getTokenSilently();
      const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!response.ok) throw Object.assign(new Error("登录状态验证失败。"), { status: response.status });
      const me = await response.json();
      authUser = me.user;
      capabilities = me.capabilities;
      await renderRoute();
    } catch (error) {
      authInitializationError = error;
      authUser = null;
      capabilities = { ...DEFAULT_CAPABILITIES };
    } finally {
      updateAccountButton();
      paintAccountDialog();
    }
  }

  bindAccountControls();
  updateAccountButton();
  return { start, initializeAuth, renderRoute, openAccountDialog };
}

if (typeof document !== "undefined" && document.querySelector("#app")) {
  const watchTower = createWatchTowerApp({
    document,
    window,
    fetch: window.fetch.bind(window),
    auth0: window.auth0,
  });
  void watchTower.start();
  void watchTower.initializeAuth();
}
