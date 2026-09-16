import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const markdownPlugins = [remarkGfm];
const highlightPlugins = [
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];
const markdownComponents = {
  a: ({ children, href }) => (
    <a
      href={/^https?:\/\//.test(href || "") ? href : undefined}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="muted">[图片：{alt || "附件"}]</span>,
  table: ({ children }) => (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label="表格"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};
export default function MarkdownContent({ text }) {
  return <Markdown remarkPlugins={markdownPlugins}
    rehypePlugins={text.length < 100000 ? highlightPlugins : undefined}
    components={markdownComponents}>{text}</Markdown>;
}
