# Pokite introduction kit

These are reusable publication drafts, not posts already sent to a platform.

## English

**Title:** Pokite — Continue your desktop agent sessions from your phone

**Short description:** Continue your computer's supported agent sessions from
your phone. Multiple agents, one web interface. No mobile app required; connect
over LAN or Tailscale with Pokite self-hosted on your computer.

**Six features:** Continue original sessions away from your desk · Multiple
agents in one entry point · Keep your existing workflow · No mobile app · LAN
or Tailscale · Self-hosted on your computer.

**Launch draft:**

Started a coding task on your computer, then stepped away?

Pokite adds a mobile browser entry point to supported agents already on your
computer. Open a project, read a session, and send a follow-up. Codex Desktop and
Hermes Desktop use the same backend as the original desktop client.

No Pokite mobile app or account. No Pokite-hosted relay. Your computer keeps
doing the work. Other integrations include DeepSeek Harness, PenguinHarness,
Claude Code CLI and Claude Desktop Cowork, with clearly documented differences;
Cowork's control path uses Anthropic services.

Open-source macOS developer preview. Try it with a test project and report your
agent version, setup experience, and whether messages stay synchronized.

https://github.com/stwith/pokite

## 中文

**标题：** Pokite · 口袋风筝：电脑上的 Agent 继续跑，手机上接着聊

**简介：** Pokite 给电脑上的 Agent 会话加一个手机入口。离开电脑后，在同一个
网页里继续使用多个受支持的 Agent，查看进展、阅读结果、补充指令。无需手机
App，通过局域网或 Tailscale 连接，自托管在你的电脑上。

**六个特点：** 离开电脑，继续原会话 · 多个 Agent，一个入口 · 保留原来的
工作方式 · 无需手机 App · 局域网 / Tailscale · 自托管在你的电脑上。

**发布草稿：**

电脑上的 Coding Agent 还在运行，你已经离开了桌子？

Pokite 让你从手机浏览器继续受支持的 Desktop 会话。选择项目、打开会话，
就能看结果、补充指令。Codex Desktop 和 Hermes Desktop 复用电脑上的原后端，
回到桌面还可以接着聊。

不需要安装 Pokite 手机 App，不需要注册 Pokite 账号。通过局域网或自己的
Tailscale 网络连接，Pokite 不运营中转服务器。DSH、Penguin、Claude CLI 和
Cowork 也有接入，各自能力不同；Cowork 使用 Anthropic 的远程会话接口。

目前是开源的 macOS 开发者预览版。欢迎用测试项目试用，反馈安装、会话同步
和手机体验的问题。

https://github.com/stwith/pokite

## Discoverability and release experiment

- Keep README names exact: Codex Desktop, Hermes Desktop, DeepSeek Harness,
  PenguinHarness, Claude Code CLI, Claude Desktop Cowork; include mobile web,
  self-hosted, LAN, Tailscale, existing sessions and macOS naturally.
- GitHub About should describe the desktop-to-mobile workflow. Topics should
  reflect implemented capabilities rather than unsupported popular products.
- Do not imply rankings are guaranteed or that GitHub topics automatically make
  an agent recommend the repository. Do not treat stars as active users.
- First experiment: publish one introductory post after review, linking to the
  README and the privacy-safe screenshot. Observe for seven days: repository
  visits (where available), installation attempts reported by users, and issues
  about successful/failed same-session replies. No performance or adoption
  numbers are claimed in advance.
- If people interpret the product as running agents on a phone, revise the first
  sentence and diagram before broadening distribution. Do not mass-post variants.
- Screenshot regeneration: `node scripts/capture-readme-demo.mjs` after build.
  The fixture is illustrative, not a customer testimonial or benchmark.
