# 发布指南

WX Layout 有两个分发面：在线站点和 Windows 桌面程序。在线站点提供页面与 API，并用 D1 持久保存全球 ⭐；桌面程序内置前端和本地 API。为桌面包设置线上服务地址后，它会通过同一个在线 API 完成 AI 排版、配图搜索与 ⭐ 同步；未设置时仍可离线启动，并把 ⭐ 保存在本机。

## 发布在线站点

托管项目位于 `apps/site`，配置在 `apps/site/.openai/hosting.json`，数据库迁移在 `apps/site/drizzle/`。

发布前验证：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm --filter @wx-layout/site build
```

使用 Codex Sites 发布时，构建产物中的 Worker、静态资源、D1 迁移和托管配置会一起打包。公开站点需要将访问范围设为 public；发布后应分别检查 `/`、`/api/health` 和 `/api/support/star`。

用户填写的模型 API Key 不写入浏览器存储或数据库，只随当前排版请求转发给所选模型服务商。文章正文也不写入 D1；D1 仅保存 ⭐ 的哈希设备标识和创建时间。

## 生成 Windows 安装包

桌面端默认连接当前公开站点；如需连接自己的部署，可先设置 `WX_LAYOUT_SERVICE_ORIGIN`，然后运行：

```bash
pnpm --filter @wx-layout/desktop make
```

输出目录为 `apps/desktop/out/`，其中 `WX-Layout-Setup-<版本>.exe` 是可分发安装程序。当前项目没有购买代码签名证书，因此从网络下载后 Windows SmartScreen 可能显示“未知发布者”；正式大规模分发时建议为安装程序签名。

## 发布到 GitHub Releases

1. 将仓库推送到 GitHub，并确保默认分支上的检查通过。
2. 创建并推送版本标签，例如 `git tag v0.1.0`、`git push origin v0.1.0`。
3. `.github/workflows/release.yml` 会在 Windows Runner 上重新验证项目、生成安装包并创建同名 GitHub Release。

发布前不要提交 `.env`、API Key 或任何临时令牌。打赏二维码是公开展示资源，只有确认其收款账户适合公开后才应随仓库发布。
