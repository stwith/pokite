export function canonicalDesktopSessionId(id) {
  if (typeof id !== "string") return null;
  const match = /^(?:session_|cse_)((?:staging_)?[A-Za-z0-9]{1,64})$/.exec(id);
  return match ? `cse_${match[1]}` : null;
}
