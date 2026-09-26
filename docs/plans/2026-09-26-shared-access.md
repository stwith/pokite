# 访问设计：个人自用，一个长期访问码

状态：已确认并实现，2026-09-26。此决策取代之前的一次性配对、逐设备凭据及单设备吊销方案；历史审查中的相关建议不再作为当前产品需求。

## 为什么采用这个方案

Pokite 的使用场景是用户在自己的手机、平板上继续使用自己电脑中的 Agent 会话。当前不面向团队协作、分享账号或给不同用户分配权限。因此，访问流程优先保持简单：**记住一个码，自己的设备随时连接；需要时整体重置。**

## 确定的规则

| 项目 | 设计 |
| --- | --- |
| 码的格式 | 10 位字母数字，避开 0/O、1/I；输入不区分大小写，可忽略空格和连字符 |
| 访问码范围 | 每套 Pokite 服务一个码，所有自己的设备共用 |
| 网络入口 | 局域网 HTTP、Tailscale HTTP、Tailscale HTTPS 使用完全相同的码 |
| 有效期 | 长期有效，不按时间过期、不在使用后消耗；仅主动重置时更换 |
| 重复使用 | 可以重复输入、重复扫码、在多个浏览器使用，没有配对次数限制 |
| 登录过程 | 直接校验访问码，不生成新的设备令牌或设备记录 |
| 二维码与链接 | 携带当前同一个访问码，可反复使用；打开后移除页面地址栏中的凭据片段 |
| 日常重启与更新 | 保留已有状态目录时沿用原码，不自动轮换 |
| 退出连接 | 只清除当前浏览器保存的码，不影响其他入口和电脑上的任务 |
| 权限模型 | 持码者拥有同等日常会话访问能力，不提供逐设备授权或吊销 |

不同地址仍是不同的浏览器来源。例如 HTTP 和 HTTPS、局域网 IP 和 Tailscale IP 的本地存储相互独立，因此切换入口后可能需要再输入一次码或扫码。**这是登录状态分开保存，不是访问码不同，也不需要申请新码。** PWA 同样遵循浏览器的存储规则。

## 整体重置

电脑本机打开 `http://127.0.0.1:3230`，在“连接手机 → 重置访问码”中二次确认：

1. 清除原来的通知订阅并原子替换保存的访问码。
2. 所有入口立即拒绝旧码，旧事件连接随后关闭，旧二维码与旧链接一并失效。
3. 发起重置的网页保存新码，并显示更新后的链接和二维码。
4. 其他页面改用同一个新码连接，并按需重新开启通知。

重置不会清空 Agent 账号、项目、会话，也不会撤回已接受的任务。网页重置无需重启 Pokite 或 Codex。

命令行恢复入口仍保留：停止 Pokite → `npm run rotate-token` → 启动 Pokite → `npm run open`。命令行重置在服务运行时拒绝执行，避免运行内存与磁盘凭据不一致。

## 保留的边界

- 接入配置修改和访问码重置只能通过已认证的电脑 localhost 直连请求执行；Tailscale Serve 的回环转发不算本机管理操作。
- 日常查看、回复、读取连接二维码等操作可使用同一个码从局域网或 Tailscale 访问。
- 这是个人自用的共享密钥模型：不承诺同一码下的设备权限隔离；需要作废访问时采用整体重置。
- 文档、演示截图、仓库及测试只使用占位码或测试码，不写入真实访问码。

## 后续维护约束

不要仅因某个入口的登录存储独立，就重新引入一次性配对码、逐设备令牌、自动过期、自动轮换或设备注册流程。只有用户明确改变产品场景、提出多人协作或权限隔离需求时，才重新讨论认证模型。

验收必须覆盖：三个入口共用同一码、反复使用不失效、重启保持原码、整体重置后旧码全部失效、重新连接无需分别申请不同的码。测试重置使用隔离环境，不为验证功能重置用户生产环境的码。

---

## English implementation and verification notes

Confirmed requirement: one persistent access code for the owner's devices and
all three network URLs. Remove one-time tickets, credential exchange, device
registries and individual device revocation. The code changes only on explicit
reset; this migration retains the existing access-token file unchanged.

- Authenticate API requests directly against the same code on LAN and Tailscale.
- QR codes and links contain that code; browser origins save it independently.
- Login verifies access without generating or consuming any credentials.
- Local connection dialog offers a two-step global reset. Keep CLI reset for
  recovery while the service is stopped.
- Reset atomically replaces the saved code, closes old event streams, rejects old
  requests and clears notification subscriptions. Preserve agent accounts,
  sessions and accepted work. The resetting browser saves the new code.
- Keep setup and reset local-only, including rejection of loopback proxy traffic.
- Retain Tailscale detection/reconciliation, runtime update/preflight and cleanup.

Validation: API tests for reusable shared authentication, remote administration
rejection, reset persistence, stream closure and CLI locking. Chromium/WebKit
exercise repeat login, two origins using one code, reset UI and reconnection.
Live validation must reuse one code across LAN HTTP and both Tailscale URLs;
never reset the production code just to test the reset feature.

Executed: 133 tests and production build passed. Chromium/WebKit verified the
shared code on two origins, repeat use and the reset/reconnect UI. The running
Mac service was restarted without restarting Codex or changing its access code.
LAN HTTP, Tailscale HTTP and HTTPS all accepted that same code repeatedly and
returned it in connection links; remote reset was rejected with 403.

## 简化设置补充

通知在设置页直接用一个开关控制，不再弹独立说明页；只有无法开启时提示 HTTPS 或主屏幕要求。
每个 Agent 对应“在 Pokite 中启用”开关，即时控制可用入口并保存配置。关闭不停止原客户端、不卸载共享组件，已接受的任务继续处理。列表不展示文件发现等内部检测结果；只提示需要用户处理的问题。
