export function textContent(content) {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((c) => ["text", "input_text", "output_text"].includes(c.type))
          .map((c) => c.text || "")
          .join("\n")
      : "";
}
