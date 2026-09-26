import fs from "node:fs";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
const digest = (token) => createHash("sha256").update(token).digest("hex");
export class DeviceAuth {
  constructor(file, master) {
    this.file = file;
    this.master = digest(master);
    this.pairings = new Map();
    const saved = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {};
    this.legacyRegistry = fs.existsSync(file) && !saved.masterHash;
    this.resetRequired = !!saved.masterHash && saved.masterHash !== this.master;
    this.devices = saved.masterHash
      ? this.resetRequired
        ? {}
        : saved.devices
      : saved;
    this.save();
  }
  save() {
    fs.writeFileSync(
      this.file + ".tmp",
      JSON.stringify({ masterHash: this.master, devices: this.devices }),
      {
        mode: 0o600,
      },
    );
    fs.renameSync(this.file + ".tmp", this.file);
  }
  verify(token) {
    if (typeof token !== "string" || token.length > 512) return null;
    const hash = digest(token);
    const expires = this.pairings.get(hash);
    if (expires && expires > Date.now())
      return { id: "bootstrap", pairing: hash };
    if (timingSafeEqual(Buffer.from(hash), Buffer.from(this.master)))
      return { id: "bootstrap" };
    const entry = Object.entries(this.devices).find(([, d]) => d.hash === hash);
    return entry ? { id: entry[0] } : null;
  }
  pair(auth, name) {
    if (!auth) throw Object.assign(Error("请输入访问码"), { status: 401 });
    if (auth.id !== "bootstrap") {
      if (!this.devices[auth.id])
        throw Object.assign(Error("请输入访问码"), { status: 401 });
      return { existing: true };
    }
    // Authentication precedes asynchronous body parsing. Recheck and consume here,
    // in the same synchronous operation that issues the credential.
    if (auth.pairing) {
      const until = this.pairings.get(auth.pairing);
      if (!until || until <= Date.now())
        throw Object.assign(Error("配对码已使用或已过期"), { status: 401 });
      this.pairings.delete(auth.pairing);
    }
    if (Object.keys(this.devices).length >= 50)
      throw Object.assign(Error("设备数量已达上限，请撤销旧设备后重试"), {
        status: 409,
      });
    const token = randomBytes(32).toString("base64url"),
      id = randomUUID();
    this.devices[id] = {
      hash: digest(token),
      name: typeof name === "string" ? name.slice(0, 80) : "Browser",
      createdAt: Date.now(),
    };
    try {
      this.save();
    } catch (e) {
      delete this.devices[id];
      throw e;
    }
    if (auth.pairing) this.pairings.delete(auth.pairing);
    return { token, id };
  }
  pairingToken() {
    for (const [key, until] of this.pairings)
      if (until < Date.now()) this.pairings.delete(key);
    if (this.pairings.size >= 100)
      this.pairings.delete(this.pairings.keys().next().value);
    const token = randomBytes(24).toString("base64url");
    this.pairings.set(digest(token), Date.now() + 600000);
    return token;
  }
  list(current) {
    return Object.entries(this.devices).map(([id, { name, createdAt }]) => ({
      id,
      name,
      createdAt,
      current: id === current,
    }));
  }
  revoke(id) {
    const old = this.devices[id];
    delete this.devices[id];
    try {
      this.save();
    } catch (e) {
      if (old) this.devices[id] = old;
      throw e;
    }
  }
}
