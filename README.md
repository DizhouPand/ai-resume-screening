# 智能简历筛选

零依赖的简历筛选网页，通过服务端调用 Dify 已发布工作流，展示建议面试、人工复核、岗位不匹配三类结果。

## 本机运行

需要 Node.js 18 或以上。在本机的 `local.env` 中配置 `DIFY_API_BASE` 和 `DIFY_API_KEY`，然后运行：

```sh
node dev-server.js
```

打开 http://localhost:3000。`local.env` 仅用于本机，禁止提交或上传。

## 接口

浏览器只调用 `POST /api/generate`，提交 `job_description`。后端使用 Node 原生 fetch 调用 Dify 的 `POST /workflows/run`，采用 blocking 模式。结果字段约定为 `question`、`verdict1`、`verdict2`。

密钥只保留在服务端环境变量中。请求约 55 秒后超时，预留返回错误提示的时间。

## 部署

当前提供 Vercel Node 函数结构，`vercel.json` 设置最长运行时间 60 秒。部署时配置 `DIFY_API_BASE` 和 `DIFY_API_KEY`；云端无法通过 localhost 访问本机 Dify，需提供云端可达的地址。

Cloudflare Workers 已提供原生入口与部署配置，步骤见下文。

## 文件

- `index.html`：响应式网页。
- `api/generate.js`：后端输入检查、Dify 调用与结果转换。
- `dev-server.js`：本机 HTTP 服务与环境配置加载。
- `vercel.json`：Vercel 配置。
- `简历筛选.yml`：Dify 工作流文件，供参考；网页接口以已发布工作流及上述输出字段约定为准。

## Cloudflare Workers（已适配）

`worker.mjs` 使用原生 Request/Response、fetch 与 `env` 绑定，无运行时依赖。`wrangler.jsonc` 配置 Worker 与静态网页；构建只将 `index.html` 复制到 `public/`，本机配置不会成为公开资源。

在 Cloudflare 控制台创建 Worker，连接本 GitHub 仓库并选择 `main`：

- 构建命令：`node scripts/build.mjs`
- 部署命令：`npx wrangler deploy`
- 根目录：仓库根目录

在 Worker 的设置 → 变量和机密中添加：

- `DIFY_API_BASE`：可从 Cloudflare 访问的 Dify API 地址，以 `/v1` 结尾。
- `DIFY_API_KEY`：选择机密（Secret）类型，填入应用密钥。

配置后重新部署。云端不能通过 `localhost` 连接本机 Dify；可使用 HTTPS 公网地址或 Cloudflare Tunnel 暴露的地址。不要将密钥写入 Wrangler 配置、GitHub 仓库或静态网页。

本机仍使用 `node dev-server.js`；Cloudflare 使用 `worker.mjs`，Vercel 使用 `api/generate.js`。
