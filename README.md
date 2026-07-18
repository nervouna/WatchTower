# WatchTower

WatchTower 是一份面向开发者和产品从业者的中文科技情报日报。它每天从 Hacker News、Product Hunt、GitHub 和 Kickstarter 收集公开信号，筛选值得关注的项目与事件，再生成可追溯到原始来源的中文简报。

- 线上站点：<https://watchtower.damao.io>
- 最新简报：<https://watchtower.damao.io/>
- 历史归档：<https://watchtower.damao.io/archive>

## 功能

- 每日发布一份经过筛选、聚合和排序的中文热点简报。
- 展示每条热点的摘要、关注理由、标签和公开来源。
- 区分完整简报与缺少部分来源的部分简报，并在生成延迟时提示读者。
- 识别持续出现的项目，说明相对上一期发生了什么实质变化。
- 提供按日期浏览的历史归档和带游标的公开 JSON API。
- 公开阅读无需登录；白名单账号可通过 Sign in with Apple 进入反馈模式，将实体标记为“持续关注”“不相关”或“没意思”，并重试失败的语音生成。
- 为每日语音简报异步生成 AI 播客封面，并在网页、App 和系统媒体播放器中展示；封面失败不影响文字或音频。
- 可围绕已发布热点按需生成一次带出处的“拓展阅读”，覆盖背景、相关产品、外部观点、行业位置与后续信号。

## 工作方式

WatchTower 运行在 Cloudflare Workers 上，使用 D1 保存候选内容、简报、实体、运行记录和反馈。每天的流水线按 UTC 分四个阶段执行：

| UTC 时间 | 阶段 | 行为 |
| --- | --- | --- |
| 21:00 | `collect` | 为次日简报收集四个平台的候选内容，不生成简报。 |
| 22:30 | `draft` | 刷新候选内容并生成可发布草稿。 |
| 23:30 | `final` | 再次刷新发生变化的证据，并生成最终版本。 |
| 00:30 | `recovery` | 完整简报直接跳过；否则重试缺失来源，尚无简报时重试全部来源。 |

流水线通过 Tavily 搜索和提取来源内容，每个来源优先保留一组候选，再在总上限内补充高质量结果。DeepSeek 根据候选证据和历史实体生成结构化中文内容；程序会校验字段长度、候选 ID、来源覆盖、连续性和 URL 等约束。第一次结果不合格时只允许一次修复请求。

“拓展阅读”只接受已发布简报中的 `briefDate` 与 `entityId`，不接受自由搜索词。HTTP 请求只负责幂等触发；独立 Cloudflare Queue 依次完成四类 Tavily Advanced Search、最多十页 Advanced Extract 和 DeepSeek 结构化生成。每条 Search 查询最多 380 个 Unicode code points；部分 Search 成功时继续研究，全部失败或 Extract 失败时保留真实阶段错误并按队列策略重试或终止。DeepSeek 的结构、字段、长度、引用和 URL 约束会完整写入 prompt，第一次结构校验失败后只修复一次。合法单域名引用发布为 `partial`；固定板块齐全且引用至少两个域名时才为 `complete`。模型阶段失败会保留已有 evidence，后续人工触发直接重跑 DeepSeek；真正零证据不会保存空 evidence。同一实体匿名共享 24 小时缓存，过期时先返回旧结果再异步刷新。D1 以 UTC 日原子预留 credits，默认每日最多预留 120 credits，每个新任务保守预留 12 credits；失败任务不返还预留，实际 Tavily credits 与 DeepSeek tokens 按调用累计。

发布门禁以内容为准：除 `collect` 外，只要目标日期已经保存至少一条可用规范化候选，就可以进入生成流程；候选既可以来自当前阶段，也可以来自当天较早阶段保存的证据。四个来源全部成功时状态为 `complete`，否则为 `partial` 并保留缺失来源。来源数量只描述完整度，不决定能否发布。零候选不会调用模型，模型结果为零条目或未通过验证时也绝不写入简报。同一阶段可安全重试；如果最终生成失败，已有的有效草稿会被保留；如果候选证据没有变化，则不会重复调用模型。

语音简报会随文字条目数量调整长度：1–4 条按排名朗读全部条目并生成短音频，5 条及以上沿用 5–7 条且尽量覆盖来源的选取规则。生产环境通过内部变量 `BRIEF_PUSH_ENABLED=true` 启用发布推送；隔离 Dev 和静默恢复运行可设为 `false`，此时不会创建推送批次、delivery 或队列消息。

## 技术栈

- Cloudflare Workers、Cron Triggers 和 Static Assets
- Cloudflare Queues 与 Rate Limiting bindings
- Cloudflare D1（SQLite）
- TypeScript（strict mode）
- Tavily Search 与 Extract API
- DeepSeek Chat Completions API
- 小米 MiMo TTS 与 fal.ai Recraft V3
- 原生 HTML、CSS 和 JavaScript 前端
- Flutter iOS/Android 阅读客户端（`mobile/`）
- Vitest 与 Cloudflare Workers 测试池
- mise 管理 Node.js，npm 管理依赖和脚本

## 本地开发

### 1. 安装运行时和依赖

项目使用 `mise.toml` 中声明的 Node.js LTS，并提交了 `package-lock.json`：

```sh
mise install
npm ci
```

### 2. 配置本地环境变量

从模板创建本地 `.env`。该文件已被 Git 忽略，不要提交其中的真实值：

```sh
cp .env.example .env
```

需要配置以下变量：

| 变量 | 用途 |
| --- | --- |
| `TAVILY_API_KEY` | 搜索和提取四个平台的候选内容。 |
| `DEEPSEEK_API_KEY` | 生成并修复结构化中文简报。 |
| `AUTH0_MANAGEMENT_CLIENT_ID` | 账号删除专用 M2M 应用的 client ID。 |
| `AUTH0_MANAGEMENT_CLIENT_SECRET` | 账号删除专用 M2M 应用的 secret。 |
| `MIMO_API_KEY` | 合成每日语音简报。 |
| `FAL_API_KEY` | 通过 fal.ai Recraft V3 生成每日播客封面。 |

Auth0 issuer、audience、tenant domain 和三个公开 client ID 配置在 `wrangler.jsonc`。这些值不是秘密；Apple private key 只保存在 Apple/Auth0 配置中，不进入仓库或 Worker。

探索功能复用 Tavily 与 DeepSeek 密钥。非秘密配置由 `wrangler.jsonc` 管理：`ITEM_EXPLORATION_ENABLED`、`ITEM_EXPLORATION_CACHE_TTL_HOURS`、`ITEM_EXPLORATION_DAILY_TAVILY_CREDITS` 和 `ITEM_EXPLORATION_CREDIT_RESERVATION`。生产环境已启用探索入口，`env.dev` 仍保持 `ITEM_EXPLORATION_ENABLED=false`。当前查询与 prompt 合约版本分别为 `exploration-v2-bounded` 和 `exploration-v2-contract`。

### 3. 初始化本地数据库

```sh
npm run db:migrate:local
```

### 4. 启动开发服务器

```sh
npm run dev
```

该命令使用 Wrangler 的本地 Worker 环境，并启用计划任务测试支持。终端会输出实际监听地址。

本地数据库初始没有简报，因此首页 API 返回 404 属于正常状态。流水线需要真实外部 API 凭证；也可以通过测试套件使用隔离的 D1 和模拟依赖验证核心逻辑。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地 Worker，并启用计划任务测试支持。 |
| `npm run lint` | 运行 ESLint。 |
| `npm run typecheck` | 运行 TypeScript 类型检查，不生成文件。 |
| `npm test` | 在 Cloudflare Workers 测试环境中运行全部测试。 |
| `npm run test:watch` | 以 watch 模式运行测试。 |
| `npm run build` | 通过 Wrangler dry run 构建 Worker 和静态资源到 `dist/`。 |
| `npm run cf-typegen` | 根据 Wrangler 配置重新生成 Worker 环境类型。 |
| `npm run db:migrate:local` | 将 D1 migrations 应用到本地数据库。 |
| `npm run db:migrate:remote` | 将 D1 migrations 应用到远程数据库。 |
| `npm run allowlist -- list [--remote\|--dev]` | 列出本地、生产远程或隔离 Dev D1 白名单。 |
| `npm run allowlist -- add <user-id> [--note <text>] [--remote\|--dev]` | 添加或更新白名单记录；默认仅操作本地 D1。 |
| `npm run allowlist -- remove <user-id> [--remote\|--dev]` | 移除白名单权限；默认仅操作本地 D1。 |
| `npm run cover:enqueue -- [YYYY-MM-DD]` | 为指定日期或最新一期补排播客封面任务。 |
| `npm run deploy` | 使用本地 `.env` 中的 secrets 部署到 Cloudflare。 |
| `npm run deploy:dev` | 部署隔离的 `watchtower-daily-brief-dev` Worker 到 `dev.watchtower.damao.io`。 |
| `npm run db:migrate:dev` | 显式应用 Dev D1 migrations；不会修改生产 D1。 |

白名单命令使用 `--remote` 明确选择生产 D1，或使用 `--dev` 明确选择隔离的远程 Dev D1；两个参数不能同时使用。

`cover:enqueue` 调用 Auth0 白名单保护的补排接口。运行时通过当前 shell 临时提供有效 access token，例如 `WATCHTOWER_AUTH_TOKEN=... npm run cover:enqueue -- 2026-07-18`；不要将短期 token 写入仓库。

## 移动客户端

`mobile/` 是复用公开简报 API 的 Flutter 客户端。iOS 首版包含 APNs 发布通知；Android 共享阅读、离线文字缓存和后台音频，但暂不接入 FCM。

```sh
cd mobile
flutter pub get
flutter analyze
flutter test
flutter build ios --flavor dev --debug --no-codesign
flutter build ipa --flavor prod --release
flutter build appbundle
```

默认 API 地址是 `https://watchtower.damao.io`。本地联调时使用非秘密编译参数覆盖：

```sh
flutter run --flavor dev --dart-define=WATCHTOWER_API_BASE_URL=http://127.0.0.1:8787
```

使用真实 iPhone 验证隔离 Dev 环境时，必须显式指定 Dev API；仅选择 `dev` flavor 不会自动切换服务端：

```sh
flutter run \
  --flavor dev \
  -d <device-id> \
  --dart-define=WATCHTOWER_API_BASE_URL=https://dev.watchtower.damao.io
```

iOS 使用一个 `Runner` target 和两套 flavor：本地开发使用 `dev`（`io.damao.watchtower.dev`、sandbox APNs），TestFlight/App Store 使用 `prod`（`io.damao.watchtower`、production APNs）。Android applicationId 仍为 `io.damao.watchtower`。

推送需要两个已启用 Push Notifications 的 Apple Developer App ID、真实设备，以及以下 Worker secrets：`APNS_TEAM_ID`、`APNS_SANDBOX_KEY_ID`、`APNS_SANDBOX_PRIVATE_KEY`、`APNS_PRODUCTION_KEY_ID`、`APNS_PRODUCTION_PRIVATE_KEY`、`PUSH_TOKEN_ENCRYPTION_KEY`、`PUSH_TOKEN_HMAC_KEY`。私钥和加密密钥不得写入仓库或日志。Production APNs 必须通过 TestFlight 或 production provisioning 验证；本地 Debug 构建始终使用 sandbox。

## HTTP API

所有日期均为严格的 `YYYY-MM-DD` UTC 日期。

### 公开简报

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET`, `HEAD` | `/api/briefs/latest` | 获取当前已发布的最新简报。 |
| `GET`, `HEAD` | `/api/briefs/:date` | 获取指定日期的已发布简报。 |
| `GET`, `HEAD` | `/api/briefs?limit=20&cursor=...` | 按日期倒序获取简报摘要；`limit` 范围为 1–100。 |
| `GET`, `HEAD` | `/api/briefs/:date/audio` | 获取支持 Range 的已生成 WAV 语音。 |
| `GET`, `HEAD` | `/api/briefs/:date/cover` | 获取已生成的播客封面图片。 |

公开接口返回 JSON，允许跨域读取，并使用 `ETag`、五分钟公共缓存和 `stale-while-revalidate`。尚未到 `publishAt` 的简报不会被公开查询。

### 登录、反馈与账号

Web 和移动端使用 Auth0 Universal Login，并只启用 Sign in with Apple。公开简报、归档、音频、离线缓存和推送始终匿名可用。受保护接口使用 Auth0 access token；Worker 严格验证 RS256 签名、issuer、audience、authorized party、有效期和 subject，再从 D1 白名单派生能力。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/feedback?entityId=...` | 读取最多 20 个实体的当前共享反馈；不传实体时返回空反馈集合。 |
| `PUT` | `/api/feedback/:entityId` | 保存反馈，请求体为 `{"value":"follow","briefDate":"YYYY-MM-DD"}`。 |
| `DELETE` | `/api/feedback/:entityId` | 清除实体反馈。 |
| `GET` | `/api/auth/config` | 返回公开的 Auth0 客户端配置。 |
| `GET` | `/api/auth/me` | 返回当前 user ID 和反馈、语音重试能力。 |
| `DELETE` | `/api/auth/account` | 删除当前 token 对应的账号，不接受客户端指定其他 user ID。 |
| `POST` | `/api/briefs/:date/audio/retry` | 白名单用户重试失败或未完成的语音生成。 |

可用反馈值为 `follow`、`irrelevant` 和 `uninteresting`。反馈只能写入确实出现在所声明已发布简报中的实体。反馈响应使用 `Cache-Control: no-store`，也不会开放公共 CORS。

Web access token 只保存在 Auth0 SPA SDK 的内存缓存中；刷新页面时通过 Auth0 SSO cookie 静默恢复。Flutter 使用 Auth0 Credentials Manager 保存并更新凭证。合法但未加入白名单的账号仍可查看和复制自己的 user ID，但不能读取或写入反馈，也不能重试语音。

账号删除会先撤销 D1 白名单并清除反馈审计中的 user ID，再通过仅有 `delete:users` 权限的 Auth0 M2M 应用删除当前 Auth0 用户。Auth0、Apple、DNS、远程 migration、部署和远程白名单变更均属于外部或生产操作，需要单独授权。

### 拓展阅读

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/explorations/:briefDate/:entityId` | 幂等触发探索；缓存命中返回 `200`，处理中返回 `202`。 |
| `GET` | `/api/explorations/:briefDate/:entityId` | 查询已有资源；成功结果支持 `ETag` 与五分钟公共缓存。 |
| `OPTIONS` | `/api/explorations/:briefDate/:entityId` | 公共 CORS 预检。 |

处理中响应使用 `Cache-Control: no-store` 并提供 `pollAfterSeconds`。匿名触发过快或每日预留额度耗尽时返回 `429` 与 `Retry-After`；已有旧结果时仍返回旧结果并标明刷新受限。模型只能引用服务端提供的 `sourceIds`，不能创建 URL；公开链接全部来自经协议、去重和规范化校验的 Tavily 来源目录。

点击探索会触发服务端检索公开资料。同一实体的结果会匿名共享和缓存。Cloudflare 仅以原始 IP 的临时哈希作为宽松限流键，WatchTower 不把原始 IP 写入数据库或日志。网页片段只用于生成和崩溃恢复，成功后删除；公开接口只返回结构化摘要和原始链接。

## 数据与部署

- `migrations/` 是 D1 schema 的演进记录。不要修改已经应用的 migration；schema 变化应新增 migration。
- `wrangler.jsonc` 是 Worker 入口、D1 绑定、静态资源、必需 secrets、计划任务、可观测性和生产域名的事实来源。
- 当前生产环境关闭 `workers.dev`，仅通过 `watchtower.damao.io` 提供服务。
- `env.dev` 部署为独立的 `watchtower-daily-brief-dev` Worker，通过 `dev.watchtower.damao.io` 提供测试环境。它使用独立 D1、R2 和队列，并关闭 cron、语音生成和 queue consumers。Web 页面由 Cloudflare Access 的精确邮箱策略保护；更具体的 `/api/*` Access Bypass 允许原生客户端连接，公开接口仍遵循公开 API 契约，受保护接口仍由 Worker 的 Auth0 验证和 D1 白名单授权。Access 成员名单只在 Cloudflare Dashboard 管理，不写入仓库。
- 生产部署前先应用新的远程 migration，再部署 Worker：

```sh
npm run db:migrate:remote
npm run deploy
```

Dev 部署使用显式环境命令，不读取生产 `.env`：

```sh
npm run db:migrate:dev
npm run deploy:dev
```

这两个命令会改变远程状态，只应在确认 Cloudflare 账户、数据库和目标环境无误后执行。部署后至少检查首页、归档页和公开 API：

```sh
curl --fail --show-error https://watchtower.damao.io/
curl --fail --show-error 'https://watchtower.damao.io/api/briefs?limit=1'
```

## 质量检查

提交或部署前运行完整检查：

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

涉及界面时，`STYLESEED.md` 是不可漂移的设计契约。材料性界面变更还需要遵循仓库内 StyleSeed 工作流，并在展示或发布前达到至少 80 分。

## 许可证

本项目采用 [MIT License](LICENSE)。
