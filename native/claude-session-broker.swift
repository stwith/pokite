import Foundation
import Security
import CommonCrypto
import Darwin

struct Failure: Error {
    let message: String
    let status: Int
    var delivery = "not-sent"
}
func reject(_ message: String, _ status: Int = 400) -> Failure { Failure(message: message, status: status) }
func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
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
    guard let scope, matches(scope, "^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$"),
          matches(route, "^/v1/code/sessions/cse_(staging_)?[A-Za-z0-9]{1,64}(/events(\\?limit=100(&cursor=[A-Za-z0-9_%:-]{1,540})?)?)?$") else { throw reject("Unsupported Cowork route") }
    let withoutQuery = String(route.split(separator: "?", maxSplits: 1)[0])
    let parts = withoutQuery.split(separator: "/").map(String.init)
    guard let session = canonical(parts[3]) else { throw reject("Invalid session") }
    if method == "GET" && input["body"] == nil {
        return Request(id: id, method: method, route: route, scope: scope, session: session, body: nil)
    }
    guard method == "POST", route == "/v1/code/sessions/\(session)/events",
          let body = input["body"] as? [String: Any], Set(body.keys) == Set(["session_id", "events"]), body["session_id"] as? String == session,
          let events = body["events"] as? [[String: Any]], events.count == 1, Set(events[0].keys) == Set(["payload"]),
          let payload = events[0]["payload"] as? [String: Any], Set(payload.keys) == Set(["uuid", "type", "message"]), payload["type"] as? String == "user",
          let uuid = payload["uuid"] as? String, matches(uuid, "^[a-fA-F0-9-]{36}$"),
          let message = payload["message"] as? [String: Any], Set(message.keys) == Set(["role", "content"]), message["role"] as? String == "user",
          let blocks = message["content"] as? [[String: Any]], blocks.count == 1,
          Set(blocks[0].keys) == Set(["type", "text"]), blocks[0]["type"] as? String == "text",
          let text = blocks[0]["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= 50000
    else { throw reject("Only a single user message may be submitted") }
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
    var scope: String { account + ":" + organization }
}
func identity() throws -> Identity {
    let config = try jsonFile(desktopRoot.appendingPathComponent("config.json"))
    guard let account = config["lastKnownAccountUuid"] as? String, matches(account, "^[A-Za-z0-9_-]+$") else { throw reject("Sign in to Claude Desktop first", 401) }
    let directory = desktopRoot.appendingPathComponent("local-agent-mode-sessions").appendingPathComponent(account)
    let orgs = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]))?.filter {
        matches($0.lastPathComponent, "^[A-Za-z0-9_-]+$") && ((try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true)
    } ?? []
    guard orgs.count == 1 else { throw reject("Cannot uniquely identify the current Cowork organization", 409) }
    let refs = try jsonFile(orgs[0].appendingPathComponent("remote-session-spaces.json"))
    let sessions = Set((refs["entries"] as? [[String: Any]] ?? []).compactMap { entry -> String? in
        guard entry["spaceId"] is String, let id = entry["sessionId"] as? String else { return nil }
        return canonical(id)
    })
    return Identity(account: account, organization: orgs[0].lastPathComponent, config: config, sessions: sessions)
}
func allow(_ request: Request, _ owner: Identity) throws {
    if let scope = request.scope, scope != owner.scope { throw reject("Claude account changed; refresh the session", 409) }
    if let session = request.session, !owner.sessions.contains(session) { throw reject("Session is not a locally associated Cowork session", 403) }
}
func decrypt(_ encoded: String, password: Data) throws -> [String: Any] {
    guard let bytes = Data(base64Encoded: encoded), bytes.prefix(3) == Data("v10".utf8) else { throw reject("Unsupported Desktop credential format", 503) }
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
    guard result == kCCSuccess, let decoded = try JSONSerialization.jsonObject(with: Data(plain.prefix(count))) as? [String: Any] else { throw reject("Credential decoding failed", 503) }
    return decoded
}
var keychainDenied: OSStatus?
var cachedEncoded = "", cachedScope = "", cachedBearer = "", cachedExpiry: Double = 0
func bearer(_ owner: Identity) throws -> String {
    guard let encoded = (owner.config["oauth:tokenCacheV2"] ?? owner.config["oauth:tokenCache"]) as? String else { throw reject("Desktop login is unavailable", 401) }
    if encoded == cachedEncoded && cachedScope == owner.scope && cachedExpiry > Date().timeIntervalSince1970 * 1000 { return cachedBearer }
    if let denied = keychainDenied { throw reject("Claude Safe Storage authorization required (\(denied))", 401) }
    var length: UInt32 = 0, pointer: UnsafeMutableRawPointer?
    print("{\"event\":\"authorization\",\"waiting\":true}");fflush(stdout)
    let status = SecKeychainFindGenericPassword(nil, UInt32("Claude Safe Storage".utf8.count), "Claude Safe Storage", UInt32("Claude".utf8.count), "Claude", &length, &pointer, nil)
    print("{\"event\":\"authorization\",\"waiting\":false}");fflush(stdout)
    guard status == errSecSuccess, let pointer else { keychainDenied = status; throw reject("Claude Safe Storage authorization required (\(status))", 401) }
    defer { _ = memset_s(pointer, Int(length), 0, Int(length)); SecKeychainItemFreeContent(nil, pointer) }
    var password = Data(bytes: pointer, count: Int(length))
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
sessionConfig.timeoutIntervalForRequest = 20
sessionConfig.timeoutIntervalForResource = 25
let network = URLSession(configuration: sessionConfig, delegate: NoRedirect(), delegateQueue: nil)
func perform(_ route: String, _ method: String, _ body: [String: Any]?, _ owner: Identity, _ token: String) throws -> [String: Any] {
    var request = URLRequest(url: URL(string: "https://api.anthropic.com" + route)!)
    request.httpMethod = method
    for (key,value) in ["Authorization":"Bearer " + token,"Content-Type":"application/json","anthropic-version":"2023-06-01","anthropic-beta":"ccr-byoc-2025-07-29","anthropic-client-feature":"ccr","anthropic-client-platform":"web_claude_ai","x-organization-uuid":owner.organization] { request.setValue(value, forHTTPHeaderField: key) }
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
    guard let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw Failure(message:"Invalid Claude response",status:503,delivery:delivery) }
    return json
}
func sanitize(_ value: Any) -> Any {
    if let dictionary = value as? [String: Any] {
        let forbidden = Set(["accesstoken","refreshtoken","oauthtoken","authorization","cookie","cookies","apikey","token","sessiontoken","environmentvariables","env"])
        return dictionary.reduce(into: [String:Any]()) { out,pair in
            let key = pair.key.lowercased().replacingOccurrences(of:"_",with:"").replacingOccurrences(of:"-",with:"")
            if !forbidden.contains(key) { out[pair.key] = sanitize(pair.value) }
        }
    }
    if let array=value as? [Any] { return array.map(sanitize) }
    return value
}
var verifiedBearer = "", verifiedScope = ""
func handle(_ input: [String: Any]) throws -> Any {
    let request = try validate(input)
    if request.route == "/api/oauth/profile" && input["retryAuthorization"] as? Bool == true { keychainDenied = nil }
    let owner = try identity()
    try allow(request, owner)
    let token = try bearer(owner)
    if verifiedBearer != token || verifiedScope != owner.scope {
        let profile = try perform("/api/oauth/profile", "GET", nil, owner, token)
        guard (profile["account"] as? [String:Any])?["uuid"] as? String == owner.account,
              (profile["organization"] as? [String:Any])?["uuid"] as? String == owner.organization else { throw reject("Desktop account verification failed", 409) }
        verifiedBearer=token;verifiedScope=owner.scope
    }
    let before = try identity(); try allow(request,before)
    guard before.scope == owner.scope else { throw reject("Claude account changed",409) }
    let result = request.session == nil ? ["ok":true] : try perform(request.route, request.method, request.body, owner, token)
    let after: Identity
    do { after = try identity() } catch { throw Failure(message:"Desktop identity could not be rechecked",status:409,delivery:request.method == "GET" ? "not-sent" : "unknown") }
    guard after.scope == owner.scope else { throw Failure(message:"Claude account changed",status:409,delivery:request.method == "GET" ? "not-sent" : "unknown") }
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
    let clean=sanitize(["access_token":"secret","nested":["authorization":"secret","text":"content"]]) as! [String:Any]
    guard clean["access_token"] == nil, (clean["nested"] as? [String:Any])?["authorization"] == nil else { throw reject("Self-test failed sanitization",500) }
    print("cowork-broker self-test passed")
}
var coreLimit = rlimit(rlim_cur: 0, rlim_max: 0)
setrlimit(RLIMIT_CORE, &coreLimit)
if CommandLine.arguments == [CommandLine.arguments[0], "--version"] { print("pokite-cowork-broker 1");exit(0) }
if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] { do { try selfTest();exit(0) } catch { fputs("Broker self-test failed\n",stderr);exit(1) } }
guard CommandLine.arguments.count == 1, isatty(STDIN_FILENO) == 0, isatty(STDOUT_FILENO) == 0 else { exit(64) }
// Only bounded JSON requests/responses. There is deliberately no key/token export operation.
while let line = readLine() {
    var output: [String:Any] = [:]
    do {
        guard line.utf8.count <= 512 * 1024, let data=line.data(using:.utf8), let input=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw reject("Invalid broker input") }
        output["id"]=input["id"] as? String ?? "invalid"
        output["result"]=try handle(input)
    } catch let error as Failure {
        output["error"]=["message":error.message,"status":error.status,"delivery":error.delivery]
    } catch {
        output["error"]=["message":"Cowork broker could not read the current Desktop state","status":503,"delivery":"not-sent"]
    }
    if let data=try? JSONSerialization.data(withJSONObject:output), let text=String(data:data,encoding:.utf8) { print(text);fflush(stdout) }
}
network.invalidateAndCancel()
