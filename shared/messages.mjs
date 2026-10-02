// Source-language keys keep existing API errors stable for older clients.
export const en = {
  "此 Desktop Code 会话尚未连接 Remote Control，请在 Desktop 中开启后回复":
    "Enable Remote Control for this session in Desktop to reply",
  "Desktop Code 本地对话记录暂不可用":
    "Desktop Code local conversation is unavailable",
  "Desktop Code 新建会话尚未接通，已有会话仍可回复":
    "Desktop Code session creation is not connected; existing sessions remain usable",
  "当前 Claude Desktop 的远程新建功能未开放；已有会话仍可回复":
    "Remote session creation is not enabled in this Claude Desktop; existing sessions remain usable",
  "检测到 Desktop 原生远程新建功能，仍需验证接收环境和创建接口":
    "Native Desktop remote creation was detected; its environment and creation endpoint still need verification",
  复制消息: "Copy message",
  检测失败: "Detection failed",
  "请在电脑上添加此 Agent 接入": "Add this agent on your computer first",
  "本机连接中断，尚未发送":
    "Local connection interrupted; the message was not sent",
  "请打开 Hermes Desktop 并确认共享插件已安装":
    "Open Hermes Desktop and check that its sharing plugin is installed",
  连接诊断: "Connection diagnostics",
  "请在 Claude Desktop 中处理审批":
    "Approve the pending request in Claude Desktop",
  开启后检测连接: "Enable to check the connection",
  "连接检测超时，请稍后刷新": "Connection check timed out. Refresh shortly.",
  "连接不可用，请检查电脑上的 Agent":
    "Unavailable. Check the agent on your computer.",
  "请先打开 Claude Desktop": "Open Claude Desktop on your computer",
  "请在电脑上启用 Codex 共享": "Enable Codex sharing on your computer",
  尚未配置连接: "Connection is not configured",
  "CLI 按需执行，无需保持终端运行":
    "CLI runs on demand; no open terminal required",
  "未找到 Claude Code CLI": "Claude Code CLI was not found",
  "请先在电脑上登录 Claude Code CLI":
    "Sign in to Claude Code CLI on your computer",
  "Cowork 请求排队超时，尚未发送":
    "The queued request expired before it was sent",
  "检测到自定义 API 地址；请确认 Desktop Code 实际使用官方服务":
    "A custom API endpoint is configured. Check that Desktop Code uses the official service.",
  "检测到 API 凭据配置；Remote Control 需要 Desktop 使用 Claude 订阅登录":
    "API credentials are configured. Remote Control requires a Claude subscription login in Desktop.",
  "Claude 配置无法读取，请检查 settings.json":
    "Cannot read Claude configuration. Check settings.json.",
  "Claude API 地址格式无效": "Invalid Claude API endpoint",
  "第三方云服务配置不支持 Remote Control，请核对 Desktop Code 配置":
    "Third-party cloud settings do not support Remote Control. Check Desktop Code configuration.",
  "若仍未连接，请在 Desktop 检查订阅、组织 Remote Control 权限和数据保留策略；本地配置无法确认这些账号条件":
    "If still disconnected, check your subscription, organization Remote Control policy and data retention settings in Desktop. Local configuration cannot confirm account eligibility.",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC 已开启，Remote Control 可能无法建立，请在电脑上检查配置":
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is enabled. Check your computer configuration; it can block Remote Control.",
  "DISABLE_GROWTHBOOK 已开启，Remote Control 可能无法建立，请在电脑上检查配置":
    "DISABLE_GROWTHBOOK is enabled. Check your computer configuration; it can block Remote Control.",
  "请在 Claude Desktop 的 Code 中开启会话的 Remote Control。":
    "Enable Remote Control for a session in Claude Desktop Code.",
  "访问码已失效，请重新连接":
    "Your access code is no longer valid. Reconnect to continue.",
  未发送: "Not sent",
  "Claude 模型列表不可用": "Claude model catalog is unavailable",
  请选择可用的云端项目: "Choose an available cloud project",
  "新会话创建结果未确认，请刷新列表核对，不会自动重建。":
    "Session creation is unconfirmed. Check the session list; it will not be created again automatically.",
  "模型或强度可能已切换，但确认尚未收到；消息未发送，请核对原会话后重试。":
    "The model or effort may already have changed, but confirmation has not arrived. Your message was not sent; check the original session before retrying.",
  "当前账号暂无可读取的云端会话。":
    "No readable cloud sessions for this account.",
  "Claude 云端项目格式不兼容": "Unsupported Claude cloud project format",
  "Claude 云端会话格式不兼容": "Unsupported Claude cloud session format",
  "Claude 项目分页未推进": "Claude project pagination did not advance",
  "Claude 会话分页未推进": "Claude session pagination did not advance",
  "Claude 会话分页缺少游标": "Claude session pagination is missing a cursor",
  "Claude 项目过多，目录未完整读取":
    "Claude project catalog exceeded the supported size",
  "Claude 会话过多，目录未完整读取":
    "Claude session catalog exceeded the supported size",
  "首次连接时，请在 Mac 上允许 Cowork 的钥匙串访问。":
    "On first connection, allow Cowork keychain access on your Mac.",
  "正在等待 Mac 上的 Claude Safe Storage 授权，请允许后刷新。":
    "Waiting for Claude Safe Storage authorization on your Mac. Allow access, then refresh.",
  "请在 Mac 上允许 Claude Safe Storage 钥匙串访问，然后重新连接。":
    "Allow Claude Safe Storage access on your Mac, then reconnect.",
  "请在电脑上运行 npm run setup:cowork 完成 Cowork 接入":
    "Run npm run setup:cowork on your computer to set up Cowork access",
  "选择在 Pokite 中使用的 Agent，不会关闭电脑上的应用。":
    "Choose which agents to use in Pokite. Their desktop apps keep running.",
  "需使用 HTTPS": "Requires HTTPS",
  请从主屏幕打开: "Open from the Home Screen",
  当前浏览器不支持通知: "Notifications unavailable in this browser",
  "请先启动电脑上的 Agent": "Start the agent on your computer",
  请先在电脑上创建一个会话: "Create a session on your computer first",
  "请等任务结束后，重新打开对应的 Desktop。":
    "After current tasks finish, reopen the relevant Desktop app.",
  "尝试次数过多，请一分钟后重试": "Too many attempts. Try again in one minute.",

  设置: "Settings",
  "管理语言、通知和 Agent 接入":
    "Manage language, notifications and Agent connections",
  语言: "Language",
  "Agent 接入": "Agent connections",
  "查看电脑上的 Agent，按需开启共享。":
    "View agents on your computer and enable sharing when needed.",
  "本机 Agent": "On this computer",
  "检测中…": "Checking\u2026",
  重新检测: "Refresh",
  "正在检测本机 Agent…": "Looking for agents\u2026",
  暂无检测结果: "No scan results yet",
  开启共享: "Enable sharing",
  安装插件: "Install plugin",
  "未检测到支持的 Agent": "No supported agents found",
  "添加到 Pokite": "Add to Pokite",
  共享已配置: "Sharing configured",
  待开启共享: "Sharing not configured",
  暂无会话: "No sessions yet",
  已找到服务地址: "Service address found",
  未找到服务: "Service not found",
  已找到服务记录: "Service record found",
  服务未启动: "Service not started",
  已找到会话: "Sessions found",
  已找到桌面会话: "Desktop sessions found",
  共享插件已安装: "Sharing plugin installed",

  "所有网络共用此访问码，长期有效，重置后旧码失效。":
    "One persistent access code for all networks. Resetting invalidates the old code.",
  "重置后，其他页面需使用新码连接并重新开启通知。":
    "Other pages will need the new code and must enable notifications again.",
  确认重置: "Confirm reset",
  重置访问码: "Reset access code",
  "请在电脑上通过 localhost 打开 Pokite 执行此操作":
    "Open Pokite through localhost on your computer to perform this action",
  "请在电脑上通过 localhost 打开 Pokite 生成配对二维码":
    "Open Pokite through localhost on your computer to create a pairing QR code",
  "主访问码仅限电脑本机使用，请扫码配对此设备":
    "The master code is local-only. Scan a pairing code to connect this device",
  配对码已使用或已过期: "This pairing code has already been used or expired",
  "配置操作正在进行，请稍后重试": "Setup is in progress. Try again shortly.",
  "配置未完成，请查看电脑上的 Pokite 日志。":
    "Setup did not complete. Check the Pokite log on your computer.",
  "配置已保存。请在电脑上重启 Pokite 服务；共享启用后，等待任务结束再重新打开对应 Desktop。":
    "Settings saved. Restart the Pokite service on your computer. After enabling sharing, wait for tasks to finish before reopening the relevant Desktop.",
  接入设置: "Agent setup",
  "接入你的 Agent": "Connect your agents",
  "先发现电脑上已有的项目和会话，再按需要启用共享。不会自动重启 Desktop。":
    "Discover your existing projects and sessions, then enable sharing as needed. Desktop is never restarted automatically.",
  "检测本机 Agent": "Discover local agents",
  保存已发现的接入: "Save discovered agents",
  "启用 Codex 共享": "Enable Codex sharing",
  "安装 Hermes 共享插件": "Install Hermes sharing plugin",
  "Agent 队列中": "In agent queue",
  "Claude Desktop 当前账号存在多个组织的本地记录，尚无法确认当前组织，已暂停混合展示。":
    "Multiple organizations were found for this Claude account. Listing is paused until its organization is known.",
  "Claude Desktop 远程接入目前支持 macOS。":
    "Claude Desktop remote access currently requires macOS.",
  "Claude 会话不存在或账号已切换。":
    "Claude session not found, or the account changed.",
  "Claude 会话正在执行或状态尚未确认，请等待结束后回复":
    "Claude is running or its status is unknown. Wait before replying.",
  "Claude 会话身份不一致。": "Claude session identity mismatch.",
  "Claude 历史格式不兼容。": "Unsupported Claude history format.",
  "Claude 历史游标未推进。": "Claude history cursor did not advance.",
  "Claude 历史游标格式不兼容。": "Unsupported Claude history cursor.",
  "Claude 响应未完整接收。": "Claude response was interrupted.",
  "Claude 响应格式不兼容。": "Unsupported Claude response format.",
  "Claude 执行失败，请查看会话中的错误记录。":
    "Claude failed. Check the session error.",
  "Claude 登录凭据已过期或权限不可用，请在 Desktop 恢复登录。":
    "Claude credentials expired or lack access. Sign in again in Desktop.",
  "Claude 网络连接中断，请核对会话后再操作。":
    "Claude connection interrupted. Check the original session before retrying.",
  "Claude 网络预检未通过，请检查 Mac 系统代理后重新连接。":
    "Claude network check failed. Check the Mac proxy and reconnect.",
  "Claude 账号已切换，未显示旧账号结果。":
    "Claude account changed. Results from the previous account were hidden.",
  "Claude 账号已切换，请刷新。": "Claude account changed. Refresh to continue.",
  "Claude 账号已切换，请刷新会话。":
    "Claude account changed. Refresh the session.",
  "Claude 账号校验不一致，已停止访问。":
    "Claude account verification mismatch. Access stopped.",
  "Claude 连接已关闭。": "Claude connection closed.",
  "Code · 未分组": "Code · Ungrouped",
  "Codex 共享进程已变化，请等待桌面重新连接":
    "Codex shared process changed. Wait for Desktop to reconnect.",
  "Codex 已恢复为只读，桌面端写入保护已开启":
    "Codex is read-only to protect Desktop writes.",
  "Codex 桌面写入保护中": "Codex Desktop write protection is active",
  "Codex 桌面写入保护中，暂时仅查看会话":
    "Codex Desktop write protection is active. Sessions are read-only.",
  "Codex 桌面写入保护中，暂时仅查看会话。":
    "Codex Desktop write protection is active. Sessions are read-only.",
  "Cowork · 未分组": "Cowork · Ungrouped",
  "Cowork · 项目": "Cowork · Project",
  "Cowork 执行失败，请检查原会话；当前接口未提供具体错误原因。":
    "Cowork failed without error details. Check the original session.",
  "Cowork 接入已暂停：旧凭据桥接已撤除。":
    "Cowork integration is paused. The old credential bridge was removed.",
  "Cowork 接入已暂停：旧钥匙串导出方式已移除，未读取 Desktop 登录凭据。":
    "Cowork integration is paused. Keychain export was removed; Desktop credentials were not accessed.",
  "DeepSeek Harness 本轮执行失败，原服务未提供具体错误。":
    "DeepSeek Harness failed without error details.",
  "Hermes Desktop 连接中断；若正在提交，请检查原会话，避免重复发送。":
    "Hermes Desktop disconnected. Check the original session before sending again.",
  "Hermes 本地插件版本不兼容": "Unsupported Hermes plugin version",
  "Penguin 本轮执行失败，原服务未提供具体错误。":
    "Penguin failed without error details.",
  "PenguinHarness 当前仅支持在新建会话时选择模型":
    "PenguinHarness supports model selection for new sessions only",
  "[图片：": "[Image: ",
  'button[aria-label="项目与会话"]':
    'button[aria-label="Projects and sessions"]',
  "iPhone / iPad 请将 HTTPS 网页添加到主屏幕，再从主屏幕打开。":
    "On iPhone or iPad, add the HTTPS page to your Home Screen, then open it there.",
  "· 当前设备": "· This device",
  "· 正在重试": "· Retrying",
  "上一条撤回结果尚待恢复，请重新打开此会话后继续":
    "The previous withdrawal needs recovery. Reopen this session.",
  "上次提交结果未确认，请先检查会话内容。":
    "Previous submission is unconfirmed. Check the original session first.",
  "上游连接异常，Agent 正在自动重试":
    "Provider connection failed. The agent is retrying.",
  "不支持此二维码地址。": "Unsupported QR address.",
  不支持的推送服务地址: "Unsupported push endpoint",
  "不是 Pokite 首页连接。": "This is not a Pokite pairing link.",
  临时会话: "Temporary sessions",
  "为避免重复执行，后续消息已暂停。请先查看原会话确认是否送达，再点右上角 × 移除此待确认记录，队列才会继续。移除记录不会撤销已执行的任务。":
    "Later messages are paused to prevent duplicate execution. Check delivery in the original session, then remove this unconfirmed record with × to continue. Removing it does not undo executed work.",
  二维码图片仅在本机识别: "QR images are decoded on this device only",
  "二维码指向另一个地址：": "This QR code points to another address: ",
  "二维码未包含有效访问码。": "The QR code contains no valid access code.",
  "二维码生成失败，请使用下方链接":
    "Could not create the QR code. Use the link below.",
  "仅控制这台设备。通知显示会话标题和项目路径，不含对话正文。电脑需保持运行并联网。":
    "Controls this device only. Notifications show session titles and project paths, not conversation content. Keep your computer running and online.",
  任务失败: "Task failed",
  任务完成: "Task completed",
  "任务完成或失败时提醒你，点击通知回到对应会话。":
    "Get notified when tasks finish or fail. Tap a notification to open its session.",
  任务通知: "Task notifications",
  会话: "Sessions",
  会话内容: "Conversation",
  会话列表: "Session list",
  "会话已创建，消息未确认送达：":
    "Session created, but message delivery is unconfirmed: ",
  "会话已创建，消息尚未入队：":
    "Session created, but the message has not been queued: ",
  "Claude 状态未能保存，消息尚未提交":
    "Could not save Claude state. The message has not been submitted.",
  "DeepSeek Harness 协议探测响应无效":
    "Invalid DeepSeek Harness protocol detection response",
  允许本次: "Allow once",
  "先完成连接再添加。独立窗口若要求访问码，重新配对即可；电脑需保持开机并运行 Pokite。":
    "Connect before adding. If the standalone window asks for an access code, pair again. Keep your computer and Pokite running.",
  关闭导航: "Collapse navigation",
  关闭提示: "Dismiss notice",
  关闭连接弹窗: "Close connection dialog",
  "加载中…": "Loading…",
  加载会话: "Load sessions",
  发送: "Send",
  "发送回执未能保存，消息尚未提交，请恢复磁盘后重试":
    "Could not save the receipt. Message not submitted; restore disk access and retry.",
  取消: "Cancel",
  口袋风筝: "Pocket kite",
  "只能选择此 Agent 的已有项目": "Select an existing project for this agent",
  回到最新消息: "Jump to latest",
  "回复…": "Reply…",
  "图片格式无法识别，请使用 PNG 或 JPEG 图片。":
    "Unsupported image format. Use PNG or JPEG.",
  "在 Safari 中打开，点分享 → 添加到主屏幕；如有“作为 Web App 打开”，保持开启。":
    "In Safari, choose Share → Add to Home Screen. Keep Open as Web App enabled when available.",
  "在哪里获取连接信息？": "Where do I find connection details?",
  "在手机浏览器菜单中选择“添加到主屏幕”。当前 HTTP 地址可能只支持快捷方式，取决于浏览器。":
    "Choose Add to Home Screen in your browser menu. HTTP may create only a shortcut, depending on the browser.",
  "在电脑上的 Pokite 打开侧栏底部的二维码按钮，查看二维码和访问码。手机与电脑需在同一局域网或 Tailscale 网络。":
    "On your computer, open the QR button at the bottom of the Pokite sidebar. Connect both devices to the same LAN or Tailscale network.",
  地址: "Address",
  "复制失败，请长按内容复制": "Copy failed. Press and hold to copy manually.",
  复制访问码: "Copy access code",
  复制链接: "Copy link",
  失败: "Failed",
  审批已失效: "Approval expired",
  审批已失效或提交失败: "Approval expired or submission failed",
  审批未送达: "Approval was not delivered",
  "局域网 HTTP": "LAN HTTP",
  工具调用: "Tool call",
  已中断: "Interrupted",
  已复制: "Copied",
  已复制链接: "Link copied",
  已完成: "Completed",
  "已找到桌面会话标题，但本机没有可读取的对话正文。":
    "Session title found, but no local conversation content is available.",
  "已找到此项目的远程会话关联；远程正文和发送尚未接入。":
    "Remote session references found. Remote conversation access is unavailable.",
  已连接: "Connected",
  未连接: "Not connected",
  已连接设备: "Connected devices",
  "开启 Tailscale 后扫码连接，无需使用 Tailscale DNS。":
    "Enable Tailscale, then scan to connect. Tailscale DNS is not required.",
  当前模型不支持所选推理强度:
    "This model does not support the selected reasoning effort",
  "当前账号暂无可读取的 Cowork 会话。":
    "No readable Cowork sessions for this account.",
  当前轮次正在运行: "The current turn is running",
  待确认: "Unconfirmed",
  或使用访问码: "Or use an access code",
  "所有已接入 Agent 的项目，无需逐个关注":
    "All connected agents and projects; no individual subscriptions needed",
  "所选模型不在当前 Agent 的可用列表中":
    "The selected model is not available for this agent",
  "手机与电脑连接同一局域网，然后扫码连接。":
    "Connect your phone and computer to the same LAN, then scan to connect.",
  打开此地址: "Open this address",
  "执行失败：": "Execution failed: ",
  拍摄二维码: "Photograph QR",
  拍摄二维码图片: "Capture QR image",
  拒绝: "Deny",
  排队中: "Queued",
  接收任务通知: "Receive task notifications",
  推理强度: "Reasoning effort",
  "推送服务暂未接收通知，请稍后重试。":
    "The push service did not accept the notification. Try again later.",
  "描述你想完成的任务…": "Describe your task…",
  提交: "Submit",
  提交中: "Submitting",
  "提交已返回，但回执未能保存；请核对原会话，暂不重发":
    "Submission returned but its receipt could not be saved. Check the original session; do not resend yet.",
  搜索会话: "Search sessions",
  撤回编辑: "Withdraw and edit",
  撤销: "Revoke",
  "撤销后该设备无法继续访问。重新连接需要新的配对码。":
    "Revoked devices lose access. A new pairing code is needed to reconnect.",
  新会话: "New session",
  新建会话: "New session",
  无效的通知订阅: "Invalid push subscription",
  无效的通知订阅密钥: "Invalid push subscription keys",
  "无法保存撤回回执，消息尚未撤回；请恢复浏览器存储后重试":
    "Could not save the withdrawal receipt. Nothing was withdrawn; restore browser storage and retry.",
  "无法唯一确认 Claude Desktop 当前组织。":
    "Cannot determine the current Claude Desktop organization.",
  "无法确认 Claude Desktop 账号，请在桌面端登录后刷新；未读取其他账号历史。":
    "Cannot verify the Claude Desktop account. Sign in there and refresh. Other account histories were not read.",
  "无法读取图片，请重新选择。": "Could not read the image. Select it again.",
  暂无会话: "No sessions yet",
  "暂时无法识别这张图片。可选择二维码截图，或复制电脑二维码下方的访问码，在这里粘贴连接。":
    "Could not decode this image. Try a QR screenshot, or paste the access code shown on your computer.",
  "服务器响应异常（HTTP": "Unexpected server response (HTTP",
  "服务正在退出，请稍后重试": "Service is shutting down. Try again shortly.",
  "服务重启，提交结果待确认；请检查原会话，避免重复发送。":
    "Service restarted; delivery is unconfirmed. Check the original session to avoid duplicates.",
  未分组: "Ungrouped",
  未分配项目: "No project",
  未发现可接入的本机会话: "No supported local sessions found",
  未命名会话: "Untitled session",
  未检测到: "Not detected: ",
  "本地存储不可用，无法保存发送回执；消息尚未发送，输入内容已保留":
    "Local storage is unavailable. No message was sent; your draft is preserved.",
  本轮执行失败: "This task failed",
  桌面会话只读: "Desktop session is read-only",
  "桌面会话记录；当前未接入 Desktop 的发送接口。":
    "Desktop session history; sending is unavailable.",
  模型: "Model",
  "模型列表暂不可用 ·": "Models temporarily unavailable ·",
  "正在加载会话…": "Loading sessions…",
  "正在压缩历史上下文，完成后继续回复":
    "Compacting conversation history before replying",
  正在恢复会话并准备模型: "Restoring the session and preparing the model",
  正在生成回复: "Generating a response",
  "正在等待 Mac 上的 Claude Safe Storage 钥匙串授权，请允许访问后重试。":
    "Waiting for Claude Safe Storage keychain authorization on the Mac.",
  正在等待模型响应: "Waiting for the model",
  "正在读取网络地址…": "Reading network addresses…",
  正在重连: "Reconnecting",
  "此 Agent 不支持修改已有会话的模型":
    "This agent cannot change the model of an existing session",
  "此 Agent 无需单独连接": "This agent does not need a separate connection",
  "此 Claude 会话不可回复。": "This Claude session cannot accept replies.",
  "此 Codex 实例的本地数据不存在或版本不兼容，请运行 doctor 检查":
    "Codex local data is missing or incompatible. Run doctor to diagnose.",
  此会话只读: "This session is read-only",
  "此会话属于 Claude Desktop，请从 Claude Desktop 的 Code 项目进入。独立 CLI 不能接管此会话。":
    "This session belongs to Claude Desktop. The independent CLI cannot take it over.",
  "此会话已在 Claude 归档。": "This session is archived in Claude.",
  "此请求已处理，详细回执已过期；请核对原会话，不会再次执行。":
    "This request was already handled and its detailed receipt expired. Check the original session; it will not execute again.",
  "此账号暂无可读取的本地 Code/Cowork 会话；云端 Chat 尚未接入。":
    "No readable local Code/Cowork sessions for this account.",
  "此项目暂无可读取的本地会话。": "No readable local sessions in this project.",
  "此项目暂无已关联的 Cowork 会话。":
    "No linked Cowork sessions in this project.",
  没有匹配的会话: "No matching sessions",
  "沿用 Claude Desktop 当前会话模型": "Uses the current Claude Desktop model",
  "沿用 Hermes Desktop 当前模型": "Uses the current Hermes Desktop model",
  "浏览器未能清除访问码，请清除此站点的网站数据后退出。":
    "Could not clear the access code. Clear this site’s browser data to disconnect.",
  消息: "Message",
  消息为空或过长: "Message is empty or too long",
  "消息尚未提交：无法保存发送状态，请检查磁盘":
    "Message not submitted: could not save delivery state. Check disk access.",
  "消息已提交或状态待确认，无法撤回编辑":
    "Message submitted or unconfirmed; it cannot be withdrawn for editing",
  "消息正在提交或已交给 Agent，无法从本地队列移除":
    "Message is being submitted or is already with the agent; it cannot be removed from the local queue",
  添加到主屏幕: "Add to Home Screen",
  "清除当前浏览器的访问码并返回首屏。电脑上的任务继续运行，其他设备不受影响。再次进入需要重新连接。":
    "Clear this browser’s credential and return to the connection screen. Computer tasks and other devices continue. Pair again to reconnect.",
  状态待确认: "Status unknown",
  电脑端正在执行: "Running on your computer",
  "电脑端连接尚未就绪，排队消息将在连接恢复后处理。":
    "Desktop connection is not ready. Queued messages will continue after reconnection.",
  移除排队消息: "Remove queued message",
  空闲: "Idle",
  立即重试: "Retry now",
  "等待 Claude 原会话恢复。":
    "Waiting for the original Claude session to recover.",
  "等待 Codex 桌面建立共享连接": "Waiting for Codex Desktop sharing",
  "等待 Hermes 当前任务结束": "Waiting for the current Hermes task to finish",
  等待原客户端释放当前轮次:
    "Waiting for the original client to finish this turn",
  等待处理: "Waiting",
  等待审批: "Awaiting approval",
  等待桌面排队消息先完成: "Waiting for Desktop’s queued messages",
  等待桌面连接: "Waiting for Desktop connection",
  粘贴访问码: "Paste access code",
  "继续电脑上正在运行的会话。":
    "Continue the sessions running on your computer.",
  "网络请求失败，请检查与 Mac 的连接":
    "Network request failed. Check the connection to your Mac.",
  网络连接异常: "Connection problem",
  "草稿尚未保存，消息尚未发送；请恢复浏览器存储后重试":
    "Draft not saved and message not sent. Restore browser storage and retry.",
  表格: "Table",
  "设备数量已达上限，请撤销旧设备后重试":
    "Device limit reached. Revoke an old device and retry.",
  访问码: "Access code",
  访问链接: "Open link",
  "请先在 Hermes Desktop 打开此会话。":
    "Open this session in Hermes Desktop first.",
  请先完成设备配对: "Complete device pairing first",
  "请先打开 Hermes Desktop。": "Open Hermes Desktop first.",
  "请先打开 Hermes Desktop，并在桌面打开一个会话。":
    "Open Hermes Desktop and a session first.",
  "请先登录 Claude Desktop。": "Sign in to Claude Desktop first.",
  请先选择已有项目: "Select an existing project first",
  "请在原 Agent 界面处理审批":
    "Handle approvals in the original agent interface",
  "请在原 Agent 界面处理当前审批。":
    "Handle this approval in the original agent interface.",
  "请在系统设置中允许 Pokite 通知。":
    "Allow Pokite notifications in system settings.",
  "请安装 Pokite 的 Hermes 本地插件，并重新打开 Hermes Desktop。":
    "Install the Pokite Hermes plugin, then reopen Hermes Desktop.",
  "请打开 Hermes Desktop 并确认本地共享插件已更新。":
    "Open Hermes Desktop and update its local sharing plugin.",
  请求已失效: "Request expired",
  "请求超时，请检查网络连接": "Request timed out. Check your network.",
  请等待本轮结束后切换模型:
    "Wait for this turn to finish before switching models",
  请输入访问码: "Enter your access code",
  "请选择小于 20 MB 的二维码图片。": "Choose a QR image smaller than 20 MB.",
  请选择已有项目: "Choose an existing project",
  "请通过 HTTPS 入口开启通知。":
    "Use the HTTPS address to enable notifications.",
  "请通过 HTTPS 开启通知": "Use HTTPS to enable notifications",
  运行中: "Running",
  "这不是有效的 Pokite 连接二维码。":
    "This is not a valid Pokite pairing QR code.",
  连接: "Connect",
  连接二维码: " pairing QR code",
  连接你的电脑: "Connect to your computer",
  连接地址: "Connection address",
  连接失败: "Connection failed",
  连接手机: "Connect a phone",
  连接手机或平板: "Connect a phone or tablet",
  连接网络: "Connection network",
  "退出此设备的连接？": "Disconnect this device?",
  退出连接: "Disconnect",
  选择二维码图片: "Choose QR image",
  选择图片: "Choose image",
  选择已有项目: "Choose an existing project",
  通知订阅来源不一致: "Push subscription origin mismatch",
  通知设备已达上限: "Push device limit reached",
  "通过 HTTPS 加密访问。请开启 Tailscale，并启用“使用 Tailscale DNS”。":
    "Connect securely over HTTPS. Enable Tailscale and Use Tailscale DNS.",
  "部分本地数据尚未保存。当前输入保留在本页，刷新或关闭页面可能丢失。":
    "Some local data is not saved. Your input remains on this page but may be lost if you refresh or close it.",
  配对码: "Pairing code",
  "配对码 10 分钟内有效，仅可使用一次。连接后每台设备使用独立凭据。":
    "Pairing codes expire after 10 minutes and can be used once. Each device gets its own credential.",
  附件: "Attachment",
  需要你的回复: "Your reply is needed",
  项目: "Project",
  项目与会话: "Projects and sessions",
  项目目录已不存在: "The project directory no longer exists",
  默认强度: "Default effort",
  默认模型: "Default model",
  "，未读": ", unread",
};
