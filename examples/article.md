---
title: 一篇示例文章
author: WX Layout
theme: minimal-blue
---

# 一篇示例文章

这是一篇用于验证微信公众号排版兼容性的示例文章。

## 内容结构

- 保持标题层级清楚；
- 使用短段落；
- 在手机端检查图片、代码和表格。

> AI 可以提出排版建议，但最终决定仍由作者完成。

```ts
import { renderWechat } from "@wx-layout/core";

const result = renderWechat("# Hello");
console.log(result.html);
```
