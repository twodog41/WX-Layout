# 发布指南

WX Layout 有两个分发面：在线站点和 Windows 桌面程序。在线站点提供页面与 API，并用 EdgeOne Blob 持久保存全球 ⭐；桌面程序内置前端，通过同一个在线 API 完成 AI 排版、配图搜索与 ⭐ 同步。

## 发布在线站点

托管项目位于 `apps/site`。在 EdgeOne Makers 中导入 GitHub 仓库时使用以下设置：

```text
项目根目录：apps/site
框架：Next.js
安装命令：pnpm --dir ../.. install --frozen-lockfile
构建命令：pnpm --dir ../.. --filter @wx-layout/core build && pnpm --dir ../.. --filter @wx-layout/ai-layout build && pnpm build
输出目录：.next
Node.js：22.11.0
生产分支：main
```

相同配置已经写入 `apps/site/edgeone.json`。API 路由由 Next.js Route Handlers 提供；`cloud-functions/api/support/star` 使用 EdgeOne Blob 保存匿名设备哈希。Blob 命名空间会在首次请求时自动创建，不需要提交数据库密钥。

发布前验证：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm --filter @wx-layout/site test
pnpm --filter @wx-layout/site build
```

将代码推送到 EdgeOne 关联的分支后会自动构建。先使用平台提供的预览地址检查 `/`、`/api/health`、`/api/layout` 和 `/api/support/star`，确认无误后再绑定正式域名。

未完成 ICP 备案时选择“全球可用区（不含中国大陆）”。需要中国大陆节点时，必须先完成 ICP 备案，再切换到中国大陆可用区或全球可用区（含中国大陆）。

正式切换域名时，先绑定并验证 `www.wxlayout.cn`，再绑定 `wxlayout.cn`。只有在 EdgeOne 预览与 HTTPS 均正常后，才把 DNSPod 中原来指向旧托管平台的记录替换为 EdgeOne 控制台给出的记录。

用户填写的模型 API Key 不写入浏览器存储或数据库，只随当前排版请求转发给所选模型服务商。文章正文也不写入服务端存储；Blob 只保存 ⭐ 的哈希设备标识和创建时间。

## 生成 Windows 安装包

桌面端默认连接 `https://wxlayout.cn`；如需连接自己的部署，可先设置 `WX_LAYOUT_SERVICE_ORIGIN`，然后运行：

```bash
pnpm --filter @wx-layout/desktop make
```

输出目录为 `apps/desktop/out/`，其中 `WX-Layout-Setup-<版本>.exe` 是可分发安装程序。当前项目没有购买代码签名证书，因此从网络下载后 Windows SmartScreen 可能显示“未知发布者”；正式大规模分发时建议为安装程序签名。

## 发布到 GitHub Releases

1. 将仓库推送到 GitHub，并确保默认分支上的检查通过。
2. 创建并推送版本标签，例如 `git tag v0.1.0`、`git push origin v0.1.0`。
3. `.github/workflows/release.yml` 会在 Windows Runner 上重新验证项目、生成安装包并创建同名 GitHub Release。

发布前不要提交 `.env`、API Key 或任何临时令牌。打赏二维码是公开展示资源，只有确认其收款账户适合公开后才应随仓库发布。
