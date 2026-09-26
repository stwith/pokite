# 安装与发布定位 / Installation and distribution scope

## 已确定的产品形式

Pokite 是电脑上的轻量本地服务，通过手机、平板或电脑的网页访问。手机也可以把网页添加到主屏幕作为 PWA。**不需要开发或发布 Pokite 原生桌面应用、菜单栏应用或手机 App。**

面向用户的交付物是一个**本地服务安装包**。“安装包”指部署服务和依赖的载体，不代表用户需要启动一个原生应用。安装后，设置、Agent 检测、配对二维码和日常使用都在网页完成。

- 电脑负责运行服务、接入已有 Agent，并保存本机配置。
- 手机通过局域网或 Tailscale 访问，使用访问认证；不需要 Pokite 外部中转服务器。
- PWA 是同一个网页的主屏幕入口，不是另一套原生客户端。
- 具体安装包格式另行确定，不预先指定为 `.app`、DMG 或 Apple `.pkg`。

## 当前可用与后续交付

**当前可用：** GitHub 源码安装。按中英文 README 的命令安装依赖、构建、检测和启动服务；网页已有 Agent 设置入口。

**后续安装包目标（尚未发布）：**

1. 部署运行环境、本地服务、网页资源和必要的接入脚本，避免依赖用户其他应用里的 Node。
2. 提供简单的启动、停止、更新和卸载命令；登录自启由用户选择。
3. 启动后给出本机网页入口，再通过网页设置和二维码连接手机。
4. 安装与升级保留配置，卸载明确区分移除服务与删除数据；不擅自中断 Agent 任务。
5. 验证干净机器上的安装、更新与卸载，并确保包内没有个人路径、账号、访问码或会话数据。

以上是安装包的验收目标，不表示已经有可下载的正式安装包。

## 停止原生应用发布路线

早期 `native/macos/`、`scripts/macos/`、`mac:*` 命令和手动 macOS 打包工作流已删除。开发签名 `.app` / DMG 不再作为交付物。电脑端用 `npm run open` 打开网页：携带长期访问码打开网页，局域网和 Tailscale 使用同一个码；需要时整体重置。

Developer ID Application、notarytool 和 Apple 公证不再列为当前源码发布或本地服务安装方案的前置事项。未来选定安装包格式后，再按实际分发方式评估签名要求；这不意味着所有 macOS 安装包都无需签名。

## English summary

Pokite is a local service with a browser interface, not a native desktop or mobile app. The intended deliverable is an installation package for the runtime, service, web assets and integration scripts. Users configure it in their browser and connect their phone over LAN or Tailscale, optionally adding the website to the Home Screen as a PWA.

Source installation is available now. A standalone service installation package has **not** been released, and its format is not yet selected. Installation, updates, opt-in autostart and safe removal must be verified before release. The existing native menu-bar prototype and development DMG are outside the agreed release scope. Apple app signing and notarization are not current release prerequisites; any future package-specific requirements will be assessed when its format is chosen.
