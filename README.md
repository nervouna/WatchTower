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
- 提供仅限站主使用的反馈模式，可将实体标记为“持续关注”“不相关”或“没意思”，并影响后续候选筛选。

## 工作方式

WatchTower 运行在 Cloudflare Workers 上，使用 D1 保存候选内容、简报、实体、运行记录和反馈。每天的流水线按 UTC 分四个阶段执行：

| UTC 时间 | 阶段 | 行为 |
| --- | --- | --- |
| 21:00 | `collect` | 为次日简报收集四个平台的候选内容，不生成简报。 |
| 22:30 | `draft` | 刷新候选内容并生成可发布草稿。 |
| 23:30 | `final` | 再次刷新发生变化的证据，并生成最终版本。 |
| 00:30 | `recovery` | 完整简报直接跳过；否则重试缺失来源，尚无简报时重试全部来源。 |

流水线通过 Tavily 搜索和提取来源内容，每个来源优先保留一组候选，再在总上限内补充高质量结果。DeepSeek 根据候选证据和历史实体生成结构化中文内容；程序会校验字段长度、候选 ID、来源覆盖、连续性和 URL 等约束。第一次结果不合格时只允许一次修复请求。

至少三个来源成功时才会发布。四个来源全部成功时状态为 `complete`，否则为 `partial`。同一阶段可安全重试；如果最终生成失败，已有的有效草稿会被保留；如果候选证据没有变化，则不会重复调用模型。

## 技术栈

- Cloudflare Workers、Cron Triggers 和 Static Assets
- Cloudflare D1（SQLite）
- TypeScript（strict mode）
- Tavily Search 与 Extract API
- DeepSeek Chat Completions API
- 原生 HTML、CSS 和 JavaScript 前端
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
| `WATCHTOWER_FEEDBACK_TOKEN` | 保护站主反馈 API 和前端反馈模式。 |

可以使用项目脚本生成高强度随机反馈凭证。脚本会将它写入本地 `.env`，并将文件权限设为仅当前用户可读写：

```sh
npm run feedback:setup
```

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
| `npm run feedback:setup` | 在本地 `.env` 中生成或替换反馈凭证。 |
| `npm run deploy` | 使用本地 `.env` 中的 secrets 部署到 Cloudflare。 |

## HTTP API

所有日期均为严格的 `YYYY-MM-DD` UTC 日期。

### 公开简报

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET`, `HEAD` | `/api/briefs/latest` | 获取当前已发布的最新简报。 |
| `GET`, `HEAD` | `/api/briefs/:date` | 获取指定日期的已发布简报。 |
| `GET`, `HEAD` | `/api/briefs?limit=20&cursor=...` | 按日期倒序获取简报摘要；`limit` 范围为 1–100。 |

公开接口返回 JSON，允许跨域读取，并使用 `ETag`、五分钟公共缓存和 `stale-while-revalidate`。尚未到 `publishAt` 的简报不会被公开查询。

### 站主反馈

反馈接口要求 `Authorization: Bearer <WATCHTOWER_FEEDBACK_TOKEN>`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/feedback?entityId=...` | 读取最多 20 个实体的当前反馈；不传实体时可用于验证凭证。 |
| `PUT` | `/api/feedback/:entityId` | 保存反馈，请求体为 `{"value":"follow","briefDate":"YYYY-MM-DD"}`。 |
| `DELETE` | `/api/feedback/:entityId` | 清除实体反馈。 |

可用反馈值为 `follow`、`irrelevant` 和 `uninteresting`。反馈只能写入确实出现在所声明已发布简报中的实体。反馈响应使用 `Cache-Control: no-store`，也不会开放公共 CORS。

浏览器中的反馈凭证只保存在当前标签页的 `sessionStorage`；退出反馈模式或关闭标签页会清除它。

## 数据与部署

- `migrations/` 是 D1 schema 的演进记录。不要修改已经应用的 migration；schema 变化应新增 migration。
- `wrangler.jsonc` 是 Worker 入口、D1 绑定、静态资源、必需 secrets、计划任务、可观测性和生产域名的事实来源。
- 当前生产环境关闭 `workers.dev`，仅通过 `watchtower.damao.io` 提供服务。
- 生产部署前先应用新的远程 migration，再部署 Worker：

```sh
npm run db:migrate:remote
npm run deploy
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
