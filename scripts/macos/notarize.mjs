import { execFileSync } from "node:child_process";
import path from "node:path";
const dmg = process.argv[2],
  profile = process.env.POKITE_NOTARY_PROFILE;
if (!dmg || !profile)
  throw Error(
    "Pass a Developer ID signed DMG and set POKITE_NOTARY_PROFILE to an existing notarytool keychain profile.",
  );
const file = path.resolve(dmg);
execFileSync(
  "/usr/bin/codesign",
  ["-dv", "--verbose=4", file],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const inspected = (() => {
  try {
    execFileSync(
      "/usr/bin/codesign",
      [
        "-v",
        "-R",
        "=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
        file,
      ],
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
})();
if (!inspected)
  throw Error(
    "Artifact is not signed with Developer ID Application; refusing notarization.",
  );
execFileSync(
  "/usr/bin/xcrun",
  ["notarytool", "submit", file, "--keychain-profile", profile,
    ...(process.env.POKITE_NOTARY_KEYCHAIN ? ["--keychain",process.env.POKITE_NOTARY_KEYCHAIN] : []), "--wait"],
  { stdio: "inherit", timeout: 1200000 },
);
execFileSync("/usr/bin/xcrun", ["stapler", "staple", file], {
  stdio: "inherit",
});
execFileSync(
  "/usr/sbin/spctl",
  ["-a", "-t", "open", "--context", "context:primary-signature", "-v", file],
  { stdio: "inherit" },
);
console.log("Notarization and Gatekeeper assessment passed.");
