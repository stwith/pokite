import Foundation
import Security
import CommonCrypto
import SQLite3
import Darwin

struct Failure: Error {
    let message: String
    let status: Int
    var delivery = "not-sent"
}
func reject(_ message: String, _ status: Int = 400) -> Failure { Failure(message: message, status: status) }
func matches(_ value: String, _ pattern: String) -> Bool { guard let range = value.range(of: pattern, options: .regularExpression) else { return false };return range.lowerBound == value.startIndex && range.upperBound == value.endIndex }
func canonical(_ id: String) -> String? {
    guard matches(id, "^(session_|cse_)(staging_)?[A-Za-z0-9]{1,64}$") else { return nil }
    return id.hasPrefix("session_") ? "cse_" + id.dropFirst(8) : id
}
struct Request {
    let id: String
    let method: String
    let route: String
    let scope: String?
    let session: String?
    let body: [String: Any]?
}
func validate(_ input: [String: Any]) throws -> Request {
    guard let id = input["id"] as? String, matches(id, "^[A-Za-z0-9_-]{1,100}$"),
          let route = input["route"] as? String, route.count <= 512 else { throw reject("Invalid broker request") }
    let method = input["method"] as? String ?? "GET"
    let scope = input["scope"] as? String
    if route == "/api/oauth/profile" && method == "GET" && input["body"] == nil {
        return Request(id: id, method: method, route: route, scope: scope, session: nil, body: nil)
    }
    if method == "GET" && input["body"] == nil,
       let scope, matches(scope, "^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$"),
       matches(route, "^/v1/code/sessions\\?limit=100&include_trigger_sessions=true&exclude_tags=-(&cursor=[A-Za-z0-9_%:-]{1,540})?$") || matches(route, "^/api/organizations/[A-Za-z0-9_-]+/projects(_v2)?(\\?limit=100&offset=[0-9]{1,6})?$") {
        return Request(id:id, method:method, route:route, scope:scope, session:nil, body:nil)
    }
    if method == "GET" && matches(route,"^/api/bootstrap/[A-Za-z0-9_-]+/app_start\\?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false$") && input["body"] == nil {
        return Request(id:id,method:method,route:route,scope:scope,session:nil,body:nil)
    }
    if method == "POST", let scope, matches(scope,"^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$"),
       matches(route,"^/api/organizations/[A-Za-z0-9_-]+/cowork/sessions$"), let body=input["body"] as? [String:Any] {
        let permitted:Set<String>=["message","message_uuid","project_uuid","model","effort_level"]
        guard Set(body.keys).isSubset(of:permitted),let text=body["message"] as? String,!text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,text.utf16.count<=50000,
              let uuid=body["message_uuid"] as? String,matches(uuid,"^[a-fA-F0-9-]{36}$") else { throw reject("Invalid session creation") }
        if let project=body["project_uuid"] { guard let p=project as? String,matches(p,"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$") else { throw reject("Invalid project") } }
        if let model=body["model"] { guard let m=model as? String,matches(m,"^[A-Za-z0-9_.\\[\\]-]{1,120}$") else { throw reject("Invalid model") } }
        if let effort=body["effort_level"] { guard let e=effort as? String,matches(e,"^[a-z_]{1,30}$") else { throw reject("Invalid effort") } }
        return Request(id:id,method:method,route:route,scope:scope,session:nil,body:body)
    }
    guard let scope, matches(scope, "^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$"),
          matches(route, "^/v1/code/sessions/cse_(staging_)?[A-Za-z0-9]{1,64}(/events(\\?limit=100(&sort_order=desc)?(&cursor=[A-Za-z0-9_%:-]{1,540})?)?)?$") else { throw reject("Unsupported Cowork route") }
    let withoutQuery = String(route.split(separator: "?", maxSplits: 1)[0])
    let parts = withoutQuery.split(separator: "/").map(String.init)
    guard let session = canonical(parts[3]) else { throw reject("Invalid session") }
    if method == "GET" && input["body"] == nil {
        return Request(id: id, method: method, route: route, scope: scope, session: session, body: nil)
    }
    guard method == "POST", route == "/v1/code/sessions/\(session)/events",
          let body=input["body"] as? [String:Any],Set(body.keys)==Set(["session_id","events"]),body["session_id"] as? String==session,
          let events=body["events"] as? [[String:Any]],!events.isEmpty,events.count<=2 else {throw reject("Invalid event envelope")}
    var controlTypes = Set<String>()
    for event in events {
        guard Set(event.keys)==Set(["payload"]),let payload=event["payload"] as? [String:Any] else {throw reject("Invalid event")}
        if payload["type"] as? String == "user" {
            guard events.count==1,Set(payload.keys)==Set(["uuid","type","message"]),let uuid=payload["uuid"] as? String,matches(uuid,"^[a-fA-F0-9-]{36}$"),
                  let message=payload["message"] as? [String:Any],Set(message.keys)==Set(["role","content"]),message["role"] as? String=="user",
                  let blocks=message["content"] as? [[String:Any]],blocks.count==1,Set(blocks[0].keys)==Set(["type","text"]),blocks[0]["type"] as? String=="text",
                  let text=blocks[0]["text"] as? String,!text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,text.utf16.count<=50000 else {throw reject("Invalid user message")}
        } else {
            guard payload["type"] as? String=="control_request",Set(payload.keys)==Set(["type","request_id","request"]),let requestId=payload["request_id"] as? String,matches(requestId,"^[A-Za-z0-9_-]{1,100}$"),let control=payload["request"] as? [String:Any] else {throw reject("Invalid control request")}
            guard let subtype=control["subtype"] as? String,!controlTypes.contains(subtype) else {throw reject("Duplicate setting control")}
            if subtype=="set_model" && controlTypes.contains("apply_flag_settings") {throw reject("Model must be set before effort")}
            controlTypes.insert(subtype)
            if control["subtype"] as? String=="set_model" {
                guard Set(control.keys)==Set(["subtype","model"]),let model=control["model"] as? String,matches(model,"^[A-Za-z0-9_.\\[\\]-]{1,120}$") else {throw reject("Invalid model control")}
            } else {
                guard control["subtype"] as? String=="apply_flag_settings",Set(control.keys)==Set(["subtype","settings"]),let settings=control["settings"] as? [String:Any],Set(settings.keys)==Set(["effortLevel"]),let effort=settings["effortLevel"] as? String,matches(effort,"^[a-z_]{1,30}$") else {throw reject("Only model and effort controls are permitted")}
            }
        }
    }
    return Request(id: id, method: method, route: route, scope: scope, session: session, body: body)
}
let desktopRoot = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Claude")
func jsonFile(_ url: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: url)
    guard data.count <= 16 * 1024 * 1024, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw reject("Invalid Desktop metadata", 503) }
    return value
}
struct Identity {
    let account: String
    let organization: String
    let config: [String: Any]
    let sessions: Set<String>
    var codeSessions: Set<String> = []
    var scope: String { account + ":" + organization }
}
func identity() throws -> Identity {
    let config = try jsonFile(desktopRoot.appendingPathComponent("config.json"))
    guard let account = config["lastKnownAccountUuid"] as? String, matches(account, "^[A-Za-z0-9_-]+$") else { throw reject("Sign in to Claude Desktop first", 401) }
    let directory = desktopRoot.appendingPathComponent("local-agent-mode-sessions").appendingPathComponent(account)
    let orgs = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]))?.filter {
        matches($0.lastPathComponent, "^[A-Za-z0-9_-]+$") && ((try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true)
    } ?? []
    let organization: String
    do { organization = try desktopCookie(name: "lastActiveOrg") }
    catch let error as Failure where error.status == 404 {
        guard orgs.count == 1 else { throw reject("Cannot identify the current Desktop organization",409) }
        organization = orgs[0].lastPathComponent
    }
    guard matches(organization,"^[A-Za-z0-9_-]+$") else { throw reject("Invalid Desktop organization",409) }
    let refsFile = directory.appendingPathComponent(organization).appendingPathComponent("remote-session-spaces.json")
    let refs = (try? jsonFile(refsFile)) ?? [:]
    let sessions = Set((refs["entries"] as? [[String: Any]] ?? []).compactMap { entry -> String? in
        guard let id = entry["sessionId"] as? String else { return nil }
        return canonical(id)
    })
    var owner=Identity(account:account,organization:organization,config:config,sessions:sessions)
    let codeRoot=desktopRoot.appendingPathComponent("claude-code-sessions").appendingPathComponent(account).appendingPathComponent(organization)
    for file in (try? FileManager.default.contentsOfDirectory(at:codeRoot,includingPropertiesForKeys:nil)) ?? [] {
        guard matches(file.lastPathComponent,"^local_[A-Za-z0-9-]+\\.json$"),let row=try? jsonFile(file),row["isArchived"] as? Bool != true else {continue}
        let ids=(row["bridgeSessionIds"] as? [String] ?? []) + [((row["remoteControlSpawn"] as? [String:Any])?["ccrSessionId"] as? String) ?? ""]
        owner.codeSessions.formUnion(ids.compactMap(canonical))
    }
    return owner
}
var catalogSessions: [String:Set<String>] = [:]
var catalogTimes: [String:Date] = [:]
func allow(_ request: Request, _ owner: Identity, checkSession: Bool = true) throws {
    if let scope = request.scope, scope != owner.scope { throw reject("Claude account changed; refresh the session", 409) }
    if request.route.hasPrefix("/api/bootstrap/") && !request.route.hasPrefix("/api/bootstrap/" + owner.organization + "/") { throw reject("Cross-organization request rejected",403) }
    if request.route.hasPrefix("/api/organizations/") && !request.route.hasPrefix("/api/organizations/" + owner.organization + "/") { throw reject("Cross-organization request rejected",403) }
    if checkSession, let session = request.session, !owner.sessions.contains(session) && !((catalogTimes[owner.scope]?.timeIntervalSinceNow ?? -1000) > -60 && (catalogSessions[owner.scope]?.contains(session) ?? false)) { throw reject("Session is not a locally associated Cowork session", 403) }
}
func decryptBytes(_ bytes: Data, password: Data) throws -> Data {
    guard bytes.prefix(3) == Data("v10".utf8) else { throw reject("Unsupported Desktop credential format", 503) }
    var derived = [UInt8](repeating: 0, count: 16)
    defer { derived.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    let salt = Array("saltysalt".utf8)
    let status = password.withUnsafeBytes { p in
        CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), p.baseAddress?.assumingMemoryBound(to: Int8.self), password.count, salt, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), 1003, &derived, 16)
    }
    guard status == kCCSuccess else { throw reject("Credential decoding failed", 503) }
    let cipher = Array(bytes.dropFirst(3)), iv = [UInt8](repeating: 32, count: 16)
    var plain = [UInt8](repeating: 0, count: cipher.count + 16), count = 0
    defer { plain.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    let result = CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding), derived, 16, iv, cipher, cipher.count, &plain, plain.count, &count)
    guard result == kCCSuccess else { throw reject("Credential decoding failed",503) }
    return Data(plain.prefix(count))
}
func decrypt(_ encoded: String, password: Data) throws -> [String: Any] {
    guard let bytes = Data(base64Encoded: encoded), let decoded = try JSONSerialization.jsonObject(with: decryptBytes(bytes,password:password)) as? [String:Any] else { throw reject("Credential decoding failed",503) }
    return decoded
}
var keychainDenied: OSStatus?
var cachedEncoded = "", cachedScope = "", cachedBearer = "", cachedExpiry: Double = 0
func readSafeStoragePassword() throws -> Data {
    if let denied = keychainDenied { throw reject("Claude Safe Storage authorization required (\(denied))", 401) }
    var length: UInt32 = 0, pointer: UnsafeMutableRawPointer?
    print("{\"event\":\"authorization\",\"waiting\":true}");fflush(stdout)
    let status = SecKeychainFindGenericPassword(nil, UInt32("Claude Safe Storage".utf8.count), "Claude Safe Storage", UInt32("Claude".utf8.count), "Claude", &length, &pointer, nil)
    print("{\"event\":\"authorization\",\"waiting\":false}");fflush(stdout)
    guard status == errSecSuccess, let pointer else { keychainDenied = status; throw reject("Claude Safe Storage authorization required (\(status))", 401) }
    defer { _ = memset_s(pointer, Int(length), 0, Int(length)); SecKeychainItemFreeContent(nil, pointer) }
    var password = Data(bytes: pointer, count: Int(length))
    return password
}
func bearer(_ owner: Identity) throws -> String {
    guard let encoded = (owner.config["oauth:tokenCacheV2"] ?? owner.config["oauth:tokenCache"]) as? String else { throw reject("Desktop login is unavailable", 401) }
    if encoded == cachedEncoded && cachedScope == owner.scope && cachedExpiry > Date().timeIntervalSince1970 * 1000 { return cachedBearer }
    var password = try readSafeStoragePassword()
    defer { password.resetBytes(in: 0..<password.count) }
    let cache = try decrypt(encoded, password: password)
    var tokenCandidates: [(String,Double)] = []
    for (key, object) in cache {
        guard key.hasPrefix("acct:\(owner.account)|"), let value = object as? [String: Any], let token = value["token"] as? String, let expires = value["expiresAt"] as? Double else { continue }
        let parts = String(key.dropFirst("acct:\(owner.account)|".count)).components(separatedBy: ":https://api.anthropic.com:")
        guard parts.count == 2, parts[0].split(separator: ":").last.map(String.init) == owner.organization else { continue }
        let scopes = Set(parts[1].split(separator: " ").map(String.init))
        guard scopes.contains("user:sessions:claude_code") else { continue }
        guard expires > Date().timeIntervalSince1970 * 1000 else { continue }
        tokenCandidates.append((token,expires))
    }
    guard tokenCandidates.count == 1 else { throw reject("Open Cowork in Claude Desktop to refresh its session authorization, then reconnect", 401) }
    cachedEncoded = encoded; cachedScope = owner.scope; cachedBearer = tokenCandidates[0].0; cachedExpiry = tokenCandidates[0].1
    return cachedBearer
}
final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
let sessionConfig = URLSessionConfiguration.ephemeral
sessionConfig.httpCookieStorage = nil
sessionConfig.httpShouldSetCookies = false
sessionConfig.timeoutIntervalForRequest = 20
sessionConfig.timeoutIntervalForResource = 25
let network = URLSession(configuration: sessionConfig, delegate: NoRedirect(), delegateQueue: nil)
var requestDeadline = Date.distantFuture
func perform(_ route: String, _ method: String, _ body: [String: Any]?, _ owner: Identity, _ token: String, web: Bool = false) throws -> Any {
    let remaining = requestDeadline.timeIntervalSinceNow
    guard remaining > 0 else { throw reject("Broker request deadline exceeded before submission",503) }
    var request = URLRequest(url: URL(string: (web ? "https://claude.ai" : "https://api.anthropic.com") + route)!)
    request.timeoutInterval = min(20,remaining)
    request.httpMethod = method
    for (key,value) in ["Authorization":"Bearer " + token,"Content-Type":"application/json","anthropic-version":"2023-06-01","anthropic-beta":"ccr-byoc-2025-07-29","anthropic-client-feature":"ccr","anthropic-client-platform":"web_claude_ai","x-organization-uuid":owner.organization] { request.setValue(value, forHTTPHeaderField: key) }
    if web { request.setValue(nil, forHTTPHeaderField:"Authorization");request.setValue("sessionKey=" + token,forHTTPHeaderField:"Cookie") }
    if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
    let done = DispatchSemaphore(value: 0)
    var data: Data?, response: URLResponse?, problem: Error?
    network.dataTask(with: request) { d,r,e in data=d;response=r;problem=e;done.signal() }.resume()
    done.wait()
    let delivery = method == "GET" ? "not-sent" : "unknown"
    guard problem == nil, let http = response as? HTTPURLResponse else { throw Failure(message:"Claude connection interrupted",status:503,delivery:delivery) }
    guard (200..<300).contains(http.statusCode) else { throw Failure(message:"Claude request failed (HTTP \(http.statusCode))",status:http.statusCode == 401 || http.statusCode == 403 ? 401 : 503,delivery:delivery) }
    let bytes = data ?? Data()
    guard bytes.count <= 16 * 1024 * 1024 else { throw Failure(message:"Claude response too large",status:503,delivery:delivery) }
    if bytes.isEmpty { return [:] }
    guard let json = try? JSONSerialization.jsonObject(with: bytes) else { throw Failure(message:"Invalid Claude response",status:503,delivery:delivery) }
    return json
}
func sanitize(_ value: Any) -> Any {
    if let dictionary = value as? [String: Any] {
        let forbidden = Set(["accesstoken","refreshtoken","oauthtoken","authorization","cookie","cookies","apikey","token","sessiontoken","sessionkey","environmentvariables","env"])
        return dictionary.reduce(into: [String:Any]()) { out,pair in
            let key = pair.key.lowercased().replacingOccurrences(of:"_",with:"").replacingOccurrences(of:"-",with:"")
            if !forbidden.contains(key) { out[pair.key] = sanitize(pair.value) }
        }
    }
    if let array=value as? [Any] { return array.map(sanitize) }
    return value
}
func desktopCookie(name: String) throws -> String {
    guard ["sessionKey","lastActiveOrg"].contains(name) else { throw reject("Unsupported cookie",400) }
    var database: OpaquePointer?
    guard sqlite3_open_v2(desktopRoot.appendingPathComponent("Cookies").path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { sqlite3_close(database);throw reject("Desktop cookie database unavailable",503) }
    defer { sqlite3_close(database) }
    sqlite3_busy_timeout(database,1000)
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database,"SELECT host_key,encrypted_value,value FROM cookies WHERE host_key IN ('.claude.ai','claude.ai') AND name=?",-1,&statement,nil) == SQLITE_OK else { throw reject("Desktop cookie schema unsupported",503) }
    defer { sqlite3_finalize(statement) }
    _ = name.withCString { sqlite3_bind_text(statement,1,$0,-1,unsafeBitCast(-1,to:sqlite3_destructor_type.self)) }
    var values = Set<String>()
    while sqlite3_step(statement) == SQLITE_ROW {
        guard let hostValue = sqlite3_column_text(statement,0), let cookieValue = sqlite3_column_text(statement,2) else { throw reject("Invalid Desktop cookie row",503) }
        let host = String(cString:hostValue)
        let value = String(cString:cookieValue)
        let format = name == "sessionKey" ? "^sk-ant-sid[A-Za-z0-9_-]+$" : "^[A-Za-z0-9_-]{1,100}$"
        if !value.isEmpty { guard matches(value,format) else { throw reject("Invalid Desktop cookie",503) };values.insert(value);continue }
        let size = Int(sqlite3_column_bytes(statement,1))
        guard size > 3, size < 8192, let buffer = sqlite3_column_blob(statement,1) else { throw reject("Invalid Desktop session cookie",503) }
        var password = try readSafeStoragePassword()
        defer { password.resetBytes(in:0..<password.count) }
        var plain = try decryptBytes(Data(bytes:buffer,count:size),password:password)
        defer { plain.resetBytes(in:0..<plain.count) }
        var digest = [UInt8](repeating:0,count:Int(CC_SHA256_DIGEST_LENGTH))
        let hostBytes = Array(host.utf8);_ = CC_SHA256(hostBytes,CC_LONG(hostBytes.count),&digest)
        // Chromium schema 24 binds encrypted cookie values to their host.
        guard plain.count > 32, plain.prefix(32) == Data(digest) else { throw reject("Desktop cookie host binding failed",503) }
        plain.removeFirst(32)
        guard let decoded=String(data:plain,encoding:.utf8),matches(decoded,format) else { throw reject("Unsupported Desktop session cookie format",503) }
        values.insert(decoded)
    }
    if values.isEmpty { throw reject("Desktop cookie unavailable",404) }
    guard values.count == 1 else { throw reject("No unique Desktop web session",409) }
    return values.first!
}
var verifiedWebCookie = "", verifiedWebAccount = "", verifiedWebAt = Date.distantPast
var modelCatalogCache: [String:([String:Any],Date)] = [:]
func bootstrapRoute(_ owner: Identity) -> String { "/api/bootstrap/" + owner.organization + "/app_start?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false" }
func modelCatalog(_ owner: Identity) throws -> [String:Any] {
    if let cached=modelCatalogCache[owner.scope],cached.1.timeIntervalSinceNow > -60 {return cached.0}
    guard let result=try webCatalog(Request(id:"models",method:"GET",route:bootstrapRoute(owner),scope:owner.scope,session:nil,body:nil),owner) as? [String:Any] else {throw reject("Model catalog unavailable",503)}
    return result
}
func modelEntry(_ owner: Identity, _ model: String?, _ effort: String?) throws {
    let catalog=try modelCatalog(owner)
    let entries=catalog["model_selector_config"] as? [[String:Any]] ?? []
    guard let surface=entries.first(where:{$0["id"] as? String=="cowork"}) ?? entries.first(where:{$0["id"] as? String=="chat"}),let models=surface["models"] as? [[String:Any]] else {throw reject("Model catalog unavailable",503)}
    guard let model,let selected=models.first(where:{$0["id"] as? String==model && $0["disabled"] as? Bool != true && $0["section"] as? String != "deprecated"}) else {throw reject("Model is not available for this account")}
    if let effort {
        let thinking=selected["thinking"] as? [String:Any] ?? [:]
        guard (thinking["effort_options"] as? [[String:Any]] ?? []).contains(where:{$0["id"] as? String==effort && $0["disabled"] as? Bool != true}) else {throw reject("Effort is not available for this model")}
    }
}
func webCatalog(_ request: Request, _ owner: Identity) throws -> Any {
    let cookie=try desktopCookie(name:"sessionKey")
    if verifiedWebCookie != cookie || verifiedWebAccount != owner.account || verifiedWebAt.timeIntervalSinceNow < -300 {
        guard let account=try perform("/api/account","GET",nil,owner,cookie,web:true) as? [String:Any],
              (account["uuid"] as? String ?? (account["account"] as? [String:Any])?["uuid"] as? String)==owner.account else {throw reject("Desktop web account mismatch",409)}
        verifiedWebCookie=cookie;verifiedWebAccount=owner.account;verifiedWebAt=Date()
    }
    if request.method == "POST" {
        try modelEntry(owner,request.body?["model"] as? String,request.body?["effort_level"] as? String)
        if let project=request.body?["project_uuid"] as? String {
            guard let detail=try perform("/api/organizations/"+owner.organization+"/projects/"+project,"GET",nil,owner,cookie,web:true) as? [String:Any],detail["uuid"] as? String==project,detail["archived_at"] == nil || detail["archived_at"] is NSNull else {throw reject("Project is unavailable",403)}
        }
    }
    guard try identity().scope==owner.scope else {throw reject("Desktop account changed",409)}
    let result=try perform(request.route,request.method,request.body,owner,cookie,web:true)
    do {
        guard try identity().scope==owner.scope else {throw reject("Desktop account changed",409)}
        if request.route.hasPrefix("/api/bootstrap/"),let object=result as? [String:Any] {
            let configs=object["model_selector_config"] as? [[String:Any]] ?? []
            let selected=configs.first(where:{$0["id"] as? String=="cowork"}) ?? configs.first(where:{$0["id"] as? String=="chat"})
            let surface=selected?["id"] as? String
            let states=(object["model_selector_state"] as? [[String:Any]] ?? []).filter{$0["id"] as? String==surface}
            let filtered:[String:Any]=["model_selector_config":sanitize(selected.map{[$0]} ?? []),"model_selector_state":sanitize(states)]
            modelCatalogCache=[owner.scope:(filtered,Date())];return filtered
        }
        if request.method == "POST" {
            guard let object=result as? [String:Any],let session=object["session"] as? [String:Any],let raw=session["id"] as? String,let id=canonical(raw) else {throw reject("Session creation result could not be confirmed",503)}
            catalogSessions[owner.scope,default:[]].insert(id);catalogTimes[owner.scope]=Date()
            var visible:[String:Any]=[:]
            for key in ["id","title","status","worker_status","created_at","updated_at","environment_kind","chat_project_id","tags"] {visible[key]=session[key]}
            if let config=session["config"] as? [String:Any] {visible["config"]=config.filter{["model","effort_level","origin"].contains($0.key)}}
            return ["session":visible]
        }
        return sanitize(result)
    } catch {
        if request.method != "GET" {throw Failure(message:"Session creation result could not be confirmed",status:503,delivery:"unknown")}
        throw error
    }
}
func rememberCatalog(_ object: [String:Any], _ owner: Identity, _ first: Bool) {
    let rows = object["data"] as? [[String:Any]] ?? []
    let ids = rows.compactMap { row -> String? in
        guard let raw = row["id"] as? String, let id = canonical(raw) else { return nil }
        let tags = row["tags"] as? [String] ?? []
        guard owner.sessions.contains(id) || (owner.codeSessions.contains(id) && row["environment_kind"] as? String == "bridge") || ((row["environment_kind"] as? String) == "anthropic_cloud" && (tags.contains("cowork-remote") || tags.contains("product:cowork-remote"))) else { return nil }
        return id
    }
    if first { catalogSessions = [owner.scope: Set(ids)];catalogTimes = [owner.scope:Date()] }
    else { catalogSessions[owner.scope,default:[]].formUnion(ids);catalogTimes[owner.scope]=Date() }
}
var verifiedBearer = "", verifiedScope = ""
func handle(_ input: [String: Any]) throws -> Any {
    let request = try validate(input)
    if request.route == "/api/oauth/profile" && input["retryAuthorization"] as? Bool == true { keychainDenied = nil }
    let owner = try identity()
    try allow(request, owner, checkSession:false)
    if request.route.hasPrefix("/api/organizations/") || request.route.hasPrefix("/api/bootstrap/") { return try webCatalog(request,owner) }
    let token = try bearer(owner)
    if verifiedBearer != token || verifiedScope != owner.scope {
        guard let profile = try perform("/api/oauth/profile", "GET", nil, owner, token) as? [String:Any] else { throw reject("Invalid profile response",503) }
        guard (profile["account"] as? [String:Any])?["uuid"] as? String == owner.account,
              (profile["organization"] as? [String:Any])?["uuid"] as? String == owner.organization else { throw reject("Desktop account verification failed", 409) }
        verifiedBearer=token;verifiedScope=owner.scope
    }
    if let id = request.session, !owner.sessions.contains(id), !((catalogTimes[owner.scope]?.timeIntervalSinceNow ?? -1000) > -60 && (catalogSessions[owner.scope]?.contains(id) ?? false)) {
        var cursor: String?; var seen = Set<String>()
        for _ in 0..<100 {
            guard requestDeadline.timeIntervalSinceNow > 0 else { throw reject("Cloud catalog deadline exceeded",503) }
            let route = "/v1/code/sessions?limit=100&include_trigger_sessions=true&exclude_tags=-" + (cursor.map { "&cursor=" + $0.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed)! } ?? "")
            guard let result = try perform(route,"GET",nil,owner,token) as? [String:Any] else { throw reject("Invalid cloud catalog",503) }
            rememberCatalog(result,owner,cursor == nil)
            if catalogSessions[owner.scope]?.contains(id) == true { break }
            guard let next = result["next_cursor"] as? String else { break }
            guard matches(next,"^[A-Za-z0-9_:-]{1,180}$"), !seen.contains(next) else { throw reject("Invalid catalog cursor",503) }
            seen.insert(next);cursor=next
        }
    }
    if request.method == "POST",let events=request.body?["events"] as? [[String:Any]],events.contains(where:{($0["payload"] as? [String:Any])?["type"] as? String=="control_request"}) {
        var selectedModel: String?,selectedEffort:String?
        for event in events {
            let control=(event["payload"] as? [String:Any])?["request"] as? [String:Any] ?? [:]
            if control["subtype"] as? String=="set_model" {selectedModel=control["model"] as? String}
            if control["subtype"] as? String=="apply_flag_settings" {selectedEffort=(control["settings"] as? [String:Any])?["effortLevel"] as? String}
        }
        if selectedModel == nil,let id=request.session {
            let response=try perform("/v1/code/sessions/"+id,"GET",nil,owner,token) as? [String:Any] ?? [:]
            let session=response["session"] as? [String:Any] ?? response["response_shape"] as? [String:Any] ?? [:]
            selectedModel=(session["config"] as? [String:Any])?["model"] as? String
        }
        try modelEntry(owner,selectedModel,selectedEffort)
    }
    let before = try identity(); try allow(request,before)
    guard before.scope == owner.scope else { throw reject("Claude account changed",409) }
    let result: Any = request.route == "/api/oauth/profile" ? ["ok":true,"account":owner.account,"organization":owner.organization] : try perform(request.route, request.method, request.body, owner, token)
    let after: Identity
    do { after = try identity() } catch { throw Failure(message:"Desktop identity could not be rechecked",status:409,delivery:request.method == "GET" ? "not-sent" : "unknown") }
    guard after.scope == owner.scope else { throw Failure(message:"Claude account changed",status:409,delivery:request.method == "GET" ? "not-sent" : "unknown") }
    if request.route.hasPrefix("/v1/code/sessions?"), let object = result as? [String:Any] {
        rememberCatalog(object,owner,!request.route.contains("&cursor="))
    }
    return sanitize(result)
}
func selfTest() throws {
    let decoded = try decrypt("djEwND+7ZYxMA8JSlgHMhaByTlX6C9zP7I4Jg3dDfJ5s3LU=", password: Data("fixture-password".utf8))
    guard decoded["fixture"] as? String == "decoded" else { throw reject("Self-test failed credential decoding",500) }
    let valid: [String:Any] = ["id":"fixture","method":"GET","route":"/v1/code/sessions/cse_example/events?limit=100","scope":"account:org"]
    let post: [String:Any] = ["id":"fixture", "method":"POST", "route":"/v1/code/sessions/cse_example/events", "scope":"account:org", "body":["session_id":"cse_example", "events":[["payload":["uuid":"00000000-0000-0000-0000-000000000000", "type":"user", "message":["role":"user", "content":[["type":"text", "text":"fixture"]]]]]]]]
    _ = try validate(post)
    var badPost = post; badPost["method"] = "DELETE"
    do { _ = try validate(badPost); throw reject("Self-test accepted a destructive method",500) } catch let e as Failure { if e.status == 500 { throw e } }
    let request = try validate(valid)
    let owner = Identity(account:"account",organization:"org",config:[:],sessions:["cse_example"])
    try allow(request,owner)
    for route in ["https://evil.invalid/", "/v1/code/sessions", "/v1/code/sessions/cse_example/worker", "/v1/code/sessions/cse_example/events?limit=100&cursor=../secret", "/export-key"] {
        var bad=valid;bad["route"]=route
        do { _ = try validate(bad); throw reject("Self-test accepted invalid route",500) } catch let e as Failure { if e.status == 500 { throw e } }
    }
    do { try allow(request,Identity(account:"account",organization:"org",config:[:],sessions:[]));throw reject("Self-test accepted foreign session",500) } catch let e as Failure { if e.status == 500 { throw e } }
    let cloudOwner = Identity(account:"account",organization:"org",config:[:],sessions:[])
    rememberCatalog(["data":[["id":"cse_cloud","environment_kind":"anthropic_cloud","tags":["cowork-remote"]],["id":"cse_code","environment_kind":"bridge","tags":["product:claude-code"]]]],cloudOwner,true)
    var cloudRequest=valid;cloudRequest["route"]="/v1/code/sessions/cse_cloud"
    try allow(validate(cloudRequest),cloudOwner)
    cloudRequest["route"]="/v1/code/sessions/cse_code"
    do { try allow(validate(cloudRequest),cloudOwner);throw reject("Self-test allowed Desktop Code",500) } catch let e as Failure { if e.status == 500 { throw e } }
    cloudRequest["route"]="/api/organizations/other/projects_v2?limit=100&offset=0"
    do { try allow(validate(cloudRequest),cloudOwner);throw reject("Self-test allowed foreign organization",500) } catch let e as Failure { if e.status == 500 { throw e } }
    cloudRequest["route"]="/v1/code/sessions/cse_cloud"
    catalogTimes[cloudOwner.scope]=Date(timeIntervalSinceNow:-61)
    do { try allow(validate(cloudRequest),cloudOwner);throw reject("Self-test allowed expired catalog grant",500) } catch let e as Failure { if e.status == 500 { throw e } }
    catalogSessions.removeAll();catalogTimes.removeAll()
    let create:[String:Any]=["id":"create","method":"POST","route":"/api/organizations/org/cowork/sessions","scope":"account:org","body":["message":"fixture","message_uuid":"00000000-0000-4000-8000-000000000000","model":"fixture-model","effort_level":"low"]]
    _ = try validate(create)
    var unsafeCreate=create;var unsafeBody=create["body"] as! [String:Any];unsafeBody["permission_mode"]="bypassPermissions";unsafeCreate["body"]=unsafeBody
    do { _ = try validate(unsafeCreate);throw reject("Self-test allowed arbitrary creation permission",500) } catch let e as Failure {if e.status==500 {throw e}}
    var settings=post
    settings["body"]=["session_id":"cse_example","events":[["payload":["type":"control_request","request_id":"model-fixture","request":["subtype":"set_model","model":"fixture-model"]]],["payload":["type":"control_request","request_id":"effort-fixture","request":["subtype":"apply_flag_settings","settings":["effortLevel":"low"]]]]]]
    _ = try validate(settings)
    settings["body"]=["session_id":"cse_example","events":[["payload":["type":"control_request","request_id":"unsafe","request":["subtype":"apply_flag_settings","settings":["permissionMode":"bypassPermissions"]]]]]]
    do { _ = try validate(settings);throw reject("Self-test allowed arbitrary flag settings",500) } catch let e as Failure {if e.status==500 {throw e}}
    var codeOwner=cloudOwner;codeOwner.codeSessions=["cse_desktop"]
    rememberCatalog(["data":[["id":"cse_desktop","environment_kind":"bridge"],["id":"cse_cli","environment_kind":"bridge"]]],codeOwner,true)
    cloudRequest["route"]="/v1/code/sessions/cse_desktop";try allow(validate(cloudRequest),codeOwner)
    cloudRequest["route"]="/v1/code/sessions/cse_cli"
    do {try allow(validate(cloudRequest),codeOwner);throw reject("Unowned CLI bridge allowed",500)}catch let e as Failure {if e.status==500{throw e}}
    catalogSessions.removeAll();catalogTimes.removeAll()
    let clean=sanitize(["access_token":"secret","nested":["authorization":"secret","text":"content"]]) as! [String:Any]
    guard clean["access_token"] == nil, (clean["nested"] as? [String:Any])?["authorization"] == nil else { throw reject("Self-test failed sanitization",500) }
    print("cowork-broker self-test passed")
}
var coreLimit = rlimit(rlim_cur: 0, rlim_max: 0)
setrlimit(RLIMIT_CORE, &coreLimit)
if CommandLine.arguments == [CommandLine.arguments[0], "--version"] { print("pokite-cowork-broker 4");exit(0) }
if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] { do { try selfTest();exit(0) } catch { fputs("Broker self-test failed\n",stderr);exit(1) } }
guard CommandLine.arguments.count == 1, isatty(STDIN_FILENO) == 0, isatty(STDOUT_FILENO) == 0 else { exit(64) }
// Only bounded JSON requests/responses. There is deliberately no key/token export operation.
while let line = readLine() {
    var output: [String:Any] = [:]
    do {
        guard line.utf8.count <= 512 * 1024, let data=line.data(using:.utf8), let input=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw reject("Invalid broker input") }
        output["id"]=input["id"] as? String ?? "invalid"
        _ = try validate(input)
        let started:[String:Any] = ["event":"started","id":output["id"]!]
        let startedData = try JSONSerialization.data(withJSONObject:started)
        print(String(data:startedData,encoding:.utf8)!);fflush(stdout)
        requestDeadline = Date(timeIntervalSinceNow:50)
        output["result"]=try handle(input)
    } catch let error as Failure {
        output["error"]=["message":error.message,"status":error.status,"delivery":error.delivery]
    } catch {
        output["error"]=["message":"Cowork broker could not read the current Desktop state","status":503,"delivery":"not-sent"]
    }
    if let data=try? JSONSerialization.data(withJSONObject:output), let text=String(data:data,encoding:.utf8) { print(text);fflush(stdout) }
}
network.invalidateAndCancel()
