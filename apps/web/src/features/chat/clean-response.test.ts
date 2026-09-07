import { expect, test } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkCleanResponse } from "./clean-response";

test("assistant prose has no decorative emoji while commands, data, and table structure survive", () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkCleanResponse], children: "✅ Router aktif! 🎉\n\n| Interface | Status |\n| --- | --- |\n| ether1 | 🟢 running |\n\n`/system identity set name=\"lab✅\"`\n\nCPU 7%, 192.168.56.2, 1+2=3." }));
  expect(html).toContain("<table>");
  expect(html).toContain("ether1");
  expect(html).toContain("CPU 7%, 192.168.56.2, 1+2=3.");
  expect(html).not.toContain("🎉");
  expect(html).not.toContain("🟢");
  expect(html).toContain("lab✅");
});
