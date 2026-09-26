import AppKit
import Foundation
import Darwin

final class PokiteDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var stateItem: NSMenuItem!
    var ownedProcess: Process?
    var timer: Timer?
    let fm = FileManager.default
    let home = FileManager.default.homeDirectoryForCurrentUser
    var resources: URL { Bundle.main.resourceURL! }
    var appRoot: URL { resources.appendingPathComponent("app") }
    var node: URL { resources.appendingPathComponent("runtime/node") }
    var state: URL {
        if let custom = ProcessInfo.processInfo.environment["POKITE_STATE_DIR"] { return URL(fileURLWithPath: custom) }
        return home.appendingPathComponent("Library/Application Support/Pokite/state")
    }
    func l(_ zh: String, _ en: String) -> String { Locale.preferredLanguages.first?.hasPrefix("zh") == true ? zh : en }
    func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: "")
        result.target = self
        return result
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "Pokite"
        statusItem.button?.image = NSImage(systemSymbolName: "paperplane", accessibilityDescription: "Pokite")
        statusItem.button?.imagePosition = .imageLeading
        let menu = NSMenu()
        stateItem = NSMenuItem(title: "Pokite", action: nil, keyEquivalent: "")
        menu.addItem(stateItem)
        menu.addItem(.separator())
        menu.addItem(item(l("打开 Pokite", "Open Pokite"), #selector(openWeb)))
        menu.addItem(item(l("接入设置", "Set up agents"), #selector(openSetup)))
        menu.addItem(item(l("启动服务", "Start service"), #selector(startService)))
        menu.addItem(item(l("停止服务…", "Stop service…"), #selector(stopService)))
        menu.addItem(item(l("重启服务…", "Restart service…"), #selector(restartService)))
        menu.addItem(item(l("查看日志", "View log"), #selector(openLog)))
        menu.addItem(item(l("登录时启动 / 关闭", "Toggle start at login"), #selector(toggleLogin)))
        menu.addItem(.separator())
        menu.addItem(item(l("卸载接入…", "Remove integrations…"), #selector(uninstall)))
        menu.addItem(item(l("退出菜单栏（服务继续运行）", "Quit menu bar (keep service running)"), #selector(quit)))
        statusItem.menu = menu
        let first = !fm.fileExists(atPath: state.appendingPathComponent("access-token").path)
        startService()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.updateStatus() }
        if first { waitAndOpen(setup: true) }
    }
    func serverRecord() -> (Int32, Int)? {
        guard let data = try? Data(contentsOf: state.appendingPathComponent("server-state.json")),
              let record = (try? JSONSerialization.jsonObject(with: data)) as? [String:Any],
              let pid = record["pid"] as? Int32, let port = record["port"] as? Int,
              port > 0, port <= 65535, kill(pid, 0) == 0 else { return nil }
        let p = Process(); let pipe = Pipe()
        p.executableURL = URL(fileURLWithPath: "/bin/ps"); p.arguments = ["-p",String(pid),"-o","command="]
        p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        let command = String(data:pipe.fileHandleForReading.readDataToEndOfFile(),encoding:.utf8) ?? ""
        p.waitUntilExit()
        guard command.contains("/server/index.mjs") else { return nil }
        return (pid,port)
    }
    func updateStatus() {
        stateItem.title = serverRecord() == nil ? l("服务未运行", "Service stopped") : l("服务运行中", "Service running")
    }
    func alert(_ message: String) {
        let a=NSAlert();a.messageText="Pokite";a.informativeText=message;a.runModal()
    }
    @objc func startService() {
        if serverRecord() != nil || ownedProcess?.isRunning == true { updateStatus(); return }
        do {
            try fm.createDirectory(at:state,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let log=state.appendingPathComponent("server.log")
            if !fm.fileExists(atPath:log.path) { fm.createFile(atPath:log.path,contents:nil,attributes:[.posixPermissions:0o600]) }
            let handle=try FileHandle(forWritingTo:log);try handle.seekToEnd()
            let p=Process();p.executableURL=node;p.arguments=[appRoot.appendingPathComponent("server/index.mjs").path]
            p.currentDirectoryURL=appRoot
            var env=ProcessInfo.processInfo.environment
            env["POKITE_STATE_DIR"]=state.path
            env["PATH"]="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:"+(env["PATH"] ?? "")
            p.environment=env;p.standardOutput=handle;p.standardError=handle;p.standardInput=FileHandle.nullDevice
            p.terminationHandler={ [weak self] _ in try? handle.close();DispatchQueue.main.async { self?.updateStatus() } }
            try p.run();ownedProcess=p;updateStatus()
        } catch { alert(l("启动失败，请检查日志：", "Could not start. Check the log: ")+error.localizedDescription) }
    }
    func waitAndOpen(setup: Bool, attempts: Int = 30) {
        if let (_,port)=serverRecord(),let token=try? String(contentsOf:state.appendingPathComponent("access-token"),encoding:.utf8),!token.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
            var components=URLComponents();components.scheme="http";components.host="127.0.0.1";components.port=port;components.path="/"
            if setup { components.query="setup=1" }
            components.fragment="token="+token.trimmingCharacters(in:.whitespacesAndNewlines)
            if let url=components.url { NSWorkspace.shared.open(url) }
            return
        }
        if attempts > 0 { DispatchQueue.main.asyncAfter(deadline:.now()+0.5){ [weak self] in self?.waitAndOpen(setup:setup,attempts:attempts-1) } }
        else { alert(l("服务尚未就绪，请查看日志。", "Service not ready. Please check its log.")) }
    }
    @objc func openWeb() { startService();waitAndOpen(setup:false) }
    @objc func openSetup() { startService();waitAndOpen(setup:true) }
    @objc func openLog() { NSWorkspace.shared.open(state.appendingPathComponent("server.log")) }
    @objc func stopService() {
        let a=NSAlert();a.messageText=l("停止 Pokite 服务？", "Stop Pokite?")
        a.informativeText=l("原 Desktop 继续运行；Pokite 执行的 Claude CLI 任务可能被中断。", "Desktop keeps running. Claude CLI tasks owned by Pokite may be interrupted.")
        a.addButton(withTitle:l("停止", "Stop"));a.addButton(withTitle:l("取消", "Cancel"))
        if a.runModal() == .alertFirstButtonReturn,let(pid,_)=serverRecord(){kill(pid,SIGTERM)}
    }
    @objc func toggleLogin() {
        let file=home.appendingPathComponent("Library/LaunchAgents/app.pokite.menubar.plist")
        do {
            if fm.fileExists(atPath:file.path){try fm.removeItem(at:file);alert(l("已关闭登录时启动。", "Start at login disabled."));return}
            guard Bundle.main.bundleURL.path.hasPrefix("/Applications/") || Bundle.main.bundleURL.path.hasPrefix(home.appendingPathComponent("Applications").path+"/") else {alert(l("请先将 Pokite.app 移入 Applications 文件夹。", "Move Pokite.app to Applications first."));return}
            let plist:[String:Any]=["Label":"app.pokite.menubar","ProgramArguments":[Bundle.main.executableURL!.path],"RunAtLoad":true]
            try fm.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true)
            try PropertyListSerialization.data(fromPropertyList:plist,format:.xml,options:0).write(to:file,options:.atomic)
            alert(l("已开启登录时启动。", "Start at login enabled."))
        } catch {alert(error.localizedDescription)}
    }
    @objc func restartService() {
        guard let(pid,_)=serverRecord() else {startService();return}
        let a=NSAlert();a.messageText=l("重启 Pokite 服务？", "Restart Pokite?")
        a.informativeText=l("原 Desktop 不会重启，Pokite 执行的 CLI 任务可能中断。", "Desktop is not restarted. CLI tasks owned by Pokite may be interrupted.")
        a.addButton(withTitle:l("重启", "Restart"));a.addButton(withTitle:l("取消", "Cancel"))
        guard a.runModal() == .alertFirstButtonReturn else {return}
        kill(pid,SIGTERM)
        waitForStop(pid,attempts:120)
    }
    func waitForStop(_ pid:Int32,attempts:Int) {
        if kill(pid,0) != 0 {ownedProcess=nil;startService();return}
        if attempts==0 {alert(l("服务仍在退出，请稍后再试。", "Service is still stopping. Try again shortly."));return}
        DispatchQueue.main.asyncAfter(deadline:.now()+0.5){[weak self] in self?.waitForStop(pid,attempts:attempts-1)}
    }
    @objc func uninstall() {
        let a=NSAlert();a.messageText=l("移除 Pokite 的启动接入？", "Remove Pokite launch integrations?")
        a.informativeText=l("保留账号、会话和数据。正在运行的 Desktop 不会重启。", "Accounts, sessions and data are preserved. Running Desktop clients are not restarted.")
        a.addButton(withTitle:l("移除", "Remove"));a.addButton(withTitle:l("取消", "Cancel"))
        guard a.runModal() == .alertFirstButtonReturn else {return}
        let p=Process();p.executableURL=node;p.arguments=[appRoot.appendingPathComponent("scripts/uninstall.mjs").path,"--apply"]
        p.environment=ProcessInfo.processInfo.environment.merging(["POKITE_STATE_DIR":state.path]){_,new in new}
        p.standardOutput=FileHandle.nullDevice;p.standardError=FileHandle.nullDevice
        p.terminationHandler={ [weak self] process in DispatchQueue.main.async {
            guard let self=self else{return}
            if process.terminationStatus==0 {try? self.fm.removeItem(at:self.home.appendingPathComponent("Library/LaunchAgents/app.pokite.menubar.plist"))}
            self.alert(process.terminationStatus==0 ? self.l("接入已移除。等待任务结束后再重新打开 Desktop。", "Integrations removed. Reopen Desktop after its tasks finish.") : self.l("卸载未完成，删除前请检查配置。", "Uninstall failed. Check configuration before deleting Pokite."))
        } }
        do {try p.run()}catch{alert(error.localizedDescription)}
    }
    @objc func quit() {NSApplication.shared.terminate(nil)}
}
if CommandLine.arguments.contains("--version") {print("Pokite 0.2.0");exit(0)}
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate=PokiteDelegate()
app.delegate=delegate
app.run()
