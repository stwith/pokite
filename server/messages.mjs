// Only strip the known, automatically prepended envelope. Quoted examples and
// occurrences inside the user's own request must remain visible.
export function userFacingText(text) {
  const prefix =
    /^\s*<in-app-browser-context source="ambient-ui-state">\r?\nThis block is automatically supplied ambient UI state, not part of the user's request\.[\s\S]*?<\/in-app-browser-context>\s*## My request:\s*\r?\n/;
  return text.replace(prefix, "");
}
