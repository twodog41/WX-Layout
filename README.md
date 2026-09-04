# WX Layout

WX Layout 是一款面向微信公众号创作者的开源 AI 排版工作台，支持 Markdown 编辑、手机端实时预览、微信兼容富文本复制，以及可审查的 AI 排版建议。它能够拆分密集信息、重组标题与卡片层级、生成装饰元素和配图搜索建议，并通过“原稿 / AI 修改稿”对照与内容保真校验，让 AI 的每一次修改都清晰、可控。项目坚持本地优先：文章与草稿默认保存在用户设备中，API Key 不写入浏览器存储；同时提供网页版与 Windows 桌面版，适合校园、社团、媒体及个人创作者快速制作更清晰、更美观的公众号文章。

> 当前状态：可运行 MVP。确定性排版内核、结构化 AI 排版、三套主题、Web 工作台、富文本复制和兼容性检查已经可用；CLI、GitHub Action 和公众号草稿同步仍在路线图中。

## 已实现

- Markdown 和 GFM 表格解析。
- 三套原创主题以及字号、行高、主题色调整。
- 所有排版样式直接内联到 HTML 元素。
- HTML 允许列表清洗，原始脚本不会进入结果。
- 图片地址、非 HTTPS 链接、表格、长代码行和多 H1 检查。
- 在 Markdown 编辑区通过 Ctrl+V 或文件选择器插入 PNG、JPG、GIF、WebP 图片（单张不超过 3 MB）。
- 沙箱手机预览。
- 同时写入 `text/html` 和 `text/plain` 的富文本复制。
- HTML 导出和本地草稿保存。
- Node.js 可复用核心包。
- 结构化 AI `LayoutPlan`，支持密集段落拆分、短句层级、信息卡片、可审查改写、视觉标题和装饰分隔线。
- AI 建议应用前以“原稿 / AI 修改稿”并排审查，并执行正文内容保真校验。
- 0–100 创作自由度：低档只整理版式，高档允许精简改写并单独展示修改记录。
- 内容筛查提示、配图位置与搜索词建议；默认使用聚合型 Openverse 开放图库，也可选 Pexels API，并保留来源署名。
- 服务端 Responses API 和 OpenAI-compatible Chat Completions 适配。
- “支持开发”微信支付弹窗、感谢文案与全站支持入口。
- 基于 D1 的全球 ⭐ 计数；同一浏览器设备默认只能支持一次。
- 可托管的 Sites 版本与 Windows 桌面安装包工程。

## 快速开始

要求 Node.js 22+ 和 pnpm 11+。

```bash
pnpm install
pnpm dev
```

点击页面顶部的“AI 排版”即可打开配置面板。新手可以选择 OpenAI、DeepSeek 一键配置或兼容 API；DeepSeek 预设会自动填写官方地址、Responses 协议和推荐模型，只需输入 API Key。排版任务会关闭 DeepSeek 的深度思考并限制输出长度，保护性超时为 90 秒。生成完成后会同时展示原稿和 AI 修改稿，确认无误后点击“应用”。API Key 只保存在当前页面内存中。部署者也可以将 `.env.example` 复制为 `.env`，预设共享的服务端模型配置。

AI 可以在不改写正文的前提下选择横幅、胶囊或下划线标题，卡片、提示或高亮内容块，以及线条、点线或双线分隔符。这些效果全部转换为微信公众号更容易保留的静态内联样式；不会添加通常会被公众号编辑器过滤的脚本动画。

“创作自由度（温度）”默认是 35：AI 可以拆开堆叠的活动时间、地点和报名信息，整理成短句或信息卡片，但不会改写正文。超过 50 后允许精简或重写密集内容，结果会在审查窗口逐项列出原文和修改后文本；数字、日期、链接和邮箱会由本地校验器锁定。背景花纹使用带纯色回退的静态内联样式，即使花纹被发布平台过滤，正文仍然可读。

AI 只生成配图搜索词和插入位置，不会在后台自动发送整篇文章。审查窗口中点击“查找候选图”后才会访问图片服务。留空 Pexels Key 时使用聚合多个开放图库的 Openverse；若当前网络无法连接 Openverse，可在 AI 面板临时填写 Pexels API Key。该 Key 与模型 Key 一样只保存在当前页面内存中。选择图片后，缩略图会保存进本机图片库并附上作者与许可证来源；开放许可信息仍需在来源页核实，发布公众号时也建议在公众号编辑器内确认并重新上传图片。

图片需要粘贴到中间的 Markdown 编辑区，右侧手机区域只是预览。图片数据保存在浏览器的本机图片库，Markdown 中只显示简短的 `wx-image://...` 引用；旧草稿里的 Base64 图片会在打开时自动迁移。编辑完成后点击“复制到公众号”，再进入 [微信公众平台](https://mp.weixin.qq.com/) 的新建图文正文中按 Ctrl+V。如果微信后台没有自动接收本机图片，应在公众号编辑器中重新上传原图并替换。页面右侧的“如何发布？”提供了同样的分步说明。

然后访问终端显示的本地地址。常用命令：

```bash
pnpm test     # 运行核心测试
pnpm check    # TypeScript 检查
pnpm build    # 构建所有工作区
```

## 发布网页与桌面程序

托管版位于 `apps/site`，使用 Cloudflare D1 保存全球 ⭐ 计数；桌面版位于 `apps/desktop`，内置网页界面并连接同一托管 API。在线地址为 <https://wx-layout-studio.pengkunwang886.chatgpt.site>。完整发布说明见 [docs/publishing.md](docs/publishing.md)。

在 Windows 上生成安装包：

```bash
pnpm --filter @wx-layout/desktop make
```

安装文件会生成到 `apps/desktop/out/`。桌面端默认连接当前公开站点，因此 AI、配图搜索和 ⭐ 会与网页使用同一套服务；自托管时可通过 `WX_LAYOUT_SERVICE_ORIGIN` 覆盖服务地址。仓库也包含按 `v*` 标签自动创建 GitHub Release 的 Windows 工作流。

全站 ⭐ 通过随机设备标识去重，标识只保存在当前浏览器，不上传原始标识，服务端仅保存 SHA-256 摘要。这适合低门槛开源项目支持计数，但清除浏览器数据或更换设备后仍可再次点击；若将来要求严格的“一人一次”，应接入 GitHub 或微信登录后按账号去重。

## 使用核心包

```ts
import { minimalBlueTheme, renderWechat } from "@wx-layout/core";

const result = renderWechat("# 标题\n\n正文", {
  theme: minimalBlueTheme
});

console.log(result.html);
console.log(result.issues);
```

## 仓库结构

```text
apps/web/            Web/PWA 工作台
apps/api/            本地 AI API 服务
apps/site/           Sites 托管应用与 D1 API
apps/desktop/        Windows Electron 桌面壳
packages/ai-layout/  结构化 AI 排版协议和 Provider
packages/core/       确定性微信排版内核
docs/                架构和设计文档
examples/            兼容性示例文章
```

详细设计参见 [docs/architecture.md](docs/architecture.md)。

## 路线图

- [x] Markdown → 微信兼容内联 HTML。
- [x] 主题 Token、手机预览和兼容性检查。
- [x] 富文本复制和 HTML 导出。
- [x] 结构化 `LayoutPlan` AI 协议。
- [x] Responses API / OpenAI-compatible Provider。
- [x] 排版建议审查后应用。
- [x] 支持开发弹窗、全站 ⭐ 计数与发布提示。
- [x] 托管站点与 Windows 桌面打包工程。
- [ ] CLI 和 GitHub Action。
- [ ] 自托管公众号图片上传和草稿同步。

## 隐私

文章和设置保存在浏览器本地。清除站点数据会删除草稿，请自行导出 Markdown 备份。API 服务不建立文章数据库，也不在应用日志中记录请求正文。

只有用户主动生成排版建议时，本地 API 服务才会把必要的段落描述发送给所选择的模型服务商。面板填写的 API Key 只保存在当前页面内存，并随当次请求发送到本机 API 服务；不会写入 `localStorage`、仓库或渲染结果。部署者也可以改用服务端环境变量。默认 Responses 请求设置 `store: false`；模型服务商最终如何处理数据仍以其账户设置和服务条款为准。

## 许可证

Apache License 2.0。参见 [LICENSE](LICENSE)。
