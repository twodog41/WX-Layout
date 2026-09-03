import type { Metadata } from "next";
import "../../web/src/styles.css";

export const metadata: Metadata = {
  title: "WX Layout · 微信公众号 AI 排版",
  description: "本地优先、可审查的微信公众号 AI 排版与手机预览工具。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
