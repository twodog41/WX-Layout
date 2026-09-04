const robots = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://wxlayout.cn/sitemap.xml
Host: wxlayout.cn
`;

export function GET() {
  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
