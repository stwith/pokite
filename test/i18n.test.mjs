import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLocale,
  translate,
  localizeResponse,
} from "../shared/i18n.mjs";
import { en } from "../shared/messages.mjs";
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
test("locale translation preserves original conversation content and identifiers", () => {
  const result = localizeResponse(
    {
      error: "请输入访问码",
      title: "新会话",
      path: "/项目/测试",
      messages: [{ role: "user", text: "运行中" }],
      executionIssue: { message: "Claude 响应未完整接收。" },
    },
    "en-US",
  );
  assert.equal(result.error, "Enter your access code");
  assert.equal(result.title, "新会话");
  assert.equal(result.path, "/项目/测试");
  assert.equal(result.messages[0].text, "运行中");
  assert.equal(
    result.executionIssue.message,
    "Claude response was interrupted.",
  );
  assert.equal(
    translate("Unknown upstream message", "en"),
    "Unknown upstream message",
  );
  assert.equal(
    translate("Claude 请求未成功（HTTP 503）。", "en"),
    "Claude request failed (HTTP 503).",
  );
  assert.equal(normalizeLocale("zh-CN,en;q=0.8"), "zh-CN");
  assert.equal(normalizeLocale("en-GB"), "en");
});

test("translation does not rewrite JSON inside a conversation or destroy Dates", () => {
  const message = {role:"user",content:{error:"请输入访问码"}};
  const date = new Date(0);
  const result = localizeResponse({messages:[message],updatedAt:date},"en");
  assert.equal(result.messages[0],message);
  assert.equal(result.updatedAt,date);
});
test("every explicit UI translation has an English catalog entry", () => {
  const missing = [];
  function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) scan(file);
      else if (/\.(js|jsx)$/.test(file)) {
        const ast = parse(fs.readFileSync(file, "utf8"), {
          sourceType: "module",
          plugins: ["jsx"],
        });
        traverse.default(ast, {
          CallExpression(p) {
            if (
              p.node.callee.name === "t" &&
              p.node.arguments[0]?.type === "StringLiteral"
            ) {
              const key = p.node.arguments[0].value;
              if (!en[key] && !en[key.trim()]) missing.push({ file, key });
            }
          },
        });
      }
    }
  }
  scan("src");
  assert.deepEqual(missing, []);
});

// Discovery status codes must never leak into the product's translated list.
test("setup discovery states all have readable English labels", async () => {
  const { setupStatuses } = await import("../src/lib/setup-status.js");
  for (const label of Object.values(setupStatuses)) assert.ok(en[label], label);
});
