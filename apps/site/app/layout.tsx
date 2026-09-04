import type { Metadata } from "next";
import "../../web/src/styles.css";

const siteUrl = new URL("https://wxlayout.cn");
const siteTitle = "WX Layout｜微信公众号 AI 排版工具";
const siteDescription = "免费、可审查的微信公众号 AI 排版工具，支持 Markdown 编辑、手机预览、主题美化、图片插入和富文本复制。";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: siteTitle,
  description: siteDescription,
  applicationName: "WX Layout",
  alternates: {
    canonical: "/"
  },
  keywords: ["WX Layout", "微信公众号排版", "AI 排版", "公众号编辑器", "Markdown 排版", "微信排版工具"],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: "WX Layout",
    title: siteTitle,
    description: siteDescription,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "WX Layout 微信公众号 AI 排版工具" }]
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og.png"]
  },
  category: "productivity"
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "WX Layout",
  alternateName: "微信公众号 AI 排版工具",
  url: "https://wxlayout.cn/",
  description: siteDescription,
  applicationCategory: "DesignApplication",
  operatingSystem: "Web, Windows",
  inLanguage: "zh-CN",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "CNY"
  },
  featureList: ["Markdown 编辑", "微信公众号兼容排版", "AI 排版建议", "手机端预览", "图片插入", "富文本复制"]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
      </body>
    </html>
  );
}
