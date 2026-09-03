# 架构说明

WX Layout 采用“确定性渲染、AI 只做决策”的设计。模型输出不会直接进入最终 HTML。

## 当前数据流

```text
Markdown
   ↓ remark-parse / remark-gfm
Markdown AST
   ↓ remark-rehype
HTML AST
   ↓ 主题 Token → 内联样式
带样式的 HTML AST
   ↓ 微信兼容性检查
检查报告
   ↓ rehype-sanitize / rehype-stringify
安全、确定性的 HTML
```

## AI 数据流

```text
Markdown AST
   ↓ 分配稳定 blockId
可供模型读取的文档描述
   ↓ AI Provider
LayoutPlan JSON
   ↓ JSON Schema + 内容保真校验
排版操作
   ↓ 本地应用操作
新的 Markdown AST
```

`LayoutPlan` 目前只允许调整标题层级、增加强调、转换引用和插入分隔线。操作完成后，系统会验证原始字符序列没有发生未授权变化；失败的结果会被拒绝，不会进入审查界面。

## 包边界

- `@wx-layout/core`：Markdown 解析、主题、渲染、清洗和兼容性检查。
- `@wx-layout/web`：本地优先的编辑与预览界面。
- `@wx-layout/ai-layout`：模型适配层、JSON Schema、结构化排版协议和内容保真应用器。
- `@wx-layout/api`：只从服务端环境读取模型凭证的本地 API。
- `@wx-layout/wechat-api`：后续加入的图片上传、草稿创建与状态校验。
- `@wx-layout/action`：后续加入的 GitHub Action。

核心包不得依赖 React、数据库或某个模型服务商。

## 安全边界

- 原始 HTML 默认不进入输出。
- 预览在无脚本权限的 iframe sandbox 中运行。
- 最终 HTML 使用允许列表清洗。
- API Key、AppSecret 和 access token 不属于核心包的数据结构。
- Web 配置面板只在 React 内存状态中保存 API Key；本地存储只记录非敏感的接口地址、协议和模型名称。
- API 服务接受单次请求凭证或部署者环境变量，且不会把凭证写入日志和响应。
- 错误和遥测不得记录文章正文或凭证。
