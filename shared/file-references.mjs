import { unified } from "unified";
import remarkParse from "remark-parse";

let parser;
export function localFileReference(value, { inline = false } = {}) {
  if (typeof value !== "string" || value.length > 4096) return null;
  let target = value.trim();
  try {
    if (target.startsWith("file://")) {
      const url = new URL(target);
      if (url.hostname && url.hostname !== "localhost") return null;
      target = url.pathname;
    } else if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  target = target.replace(/:\d+(?:-\d+)?$/, "");
  if (
    !target ||
    /[\x00-\x1f]/.test(target) ||
    target.includes("\\") ||
    target.startsWith("//")
  )
    return null;
  if (inline && !/^(\/|\.\.?\/)/.test(target)) return null;
  return /(?:^|\/)(?:[^/]+\.[a-z\d_-]+|README|LICENSE|Dockerfile|Makefile)$/i.test(
    target,
  )
    ? target
    : null;
}

export function fileReferences(text) {
  parser ||= unified().use(remarkParse);
  const targets = new Set();
  const tree = parser.parse(String(text || ""));
  const definitions = new Map();
  function definitionsIn(node) {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    node.children?.forEach(definitionsIn);
  }
  definitionsIn(tree);
  function visit(node) {
    const value =
      node.type === "link" || node.type === "image"
        ? node.url
        : node.type === "inlineCode"
          ? node.value
          : ["linkReference", "imageReference"].includes(node.type)
            ? definitions.get(node.identifier)
            : null;
    const target = localFileReference(value, {
      inline: node.type === "inlineCode",
    });
    if (target) targets.add(target);
    node.children?.forEach(visit);
  }
  visit(tree);
  return [...targets];
}

export function attachmentMarkdown(file) {
  const name = String(file.name).replace(/[\\\[\]\r\n]/g, "_");
  return `[${name}](<${encodeURI(file.path).replace(/[()]/g, (c) => encodeURIComponent(c))}>)`;
}
