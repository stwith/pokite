import { t } from "../../lib/i18n.js";
import { useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import { localFileReference } from "../../../shared/file-references.mjs";
import { FilePreviewLink } from "./file-preview";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
const markdownPlugins = [remarkGfm];
const highlightPlugins = [
  [
    rehypeHighlight,
    {
      detect: false,
      ignoreMissing: true,
    },
  ],
];
const markdownComponents = (context) => ({
  a: ({ children, href }) =>
    localFileReference(href) ? (
      <FilePreviewLink path={localFileReference(href)} context={context}>
        {children}
      </FilePreviewLink>
    ) : (
      <a
        href={/^https?:\/\//.test(href || "") ? href : undefined}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    ),
  img: ({ alt, src }) =>
    localFileReference(src) ? (
      <FilePreviewLink path={localFileReference(src)} context={context}>
        {alt || t("附件")}
      </FilePreviewLink>
    ) : (
      <span className="muted">
        {t("[图片：")}
        {alt || t("附件")}]
      </span>
    ),
  code: ({ children, className, node }) => {
    const value = String(children).replace(/\n$/, "");
    const target =
      !className &&
      typeof children === "string" &&
      !children.endsWith("\n") &&
      node.position?.start.line === node.position?.end.line
        ? localFileReference(value, { inline: true })
        : null;
    return target ? (
      <FilePreviewLink path={target} context={context}>
        {children}
      </FilePreviewLink>
    ) : (
      <code className={className}>{children}</code>
    );
  },
  table: ({ children }) => (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label={t("表格")}
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
});
export default function MarkdownContent({ text, fileContext }) {
  const components = useMemo(
    () => markdownComponents(fileContext),
    [fileContext?.agent, fileContext?.sid, fileContext?.before],
  );
  return (
    <Markdown
      remarkPlugins={markdownPlugins}
      rehypePlugins={text.length < 100000 ? highlightPlugins : undefined}
      components={components}
      urlTransform={(url) =>
        localFileReference(url) ? url : defaultUrlTransform(url)
      }
    >
      {text}
    </Markdown>
  );
}
