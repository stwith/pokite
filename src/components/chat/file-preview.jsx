import { lazy, Suspense, useEffect, useState } from "react";
import { File, LoaderCircle } from "lucide-react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
const PdfPreview = lazy(() => import("./pdf-preview"));
const MarkdownContent = lazy(() => import("./markdown-content"));

function PreviewBody({ file }) {
  if (file.kind === "image")
    return (
      <img
        className="file-preview-image"
        src={`data:${file.mime};base64,${file.base64}`}
        alt={file.name}
      />
    );
  if (file.kind === "pdf")
    return (
      <Suspense fallback={<LoaderCircle className="spin" />}>
        <PdfPreview base64={file.base64} />
      </Suspense>
    );
  if (file.kind === "markdown")
    return (
      <div className="markdown-body">
        <Suspense
          fallback={<pre className="file-preview-text">{file.text}</pre>}
        >
          <MarkdownContent text={file.text} />
        </Suspense>
        {file.truncated && (
          <p role="status">{t("文件较长，仅预览前 200 KB")}</p>
        )}
      </div>
    );
  if (file.kind === "text")
    return (
      <>
        <pre className="file-preview-text">{file.text}</pre>
        {file.truncated && (
          <p role="status">{t("文件较长，仅预览前 200 KB")}</p>
        )}
      </>
    );
  return <p role="status">{t("此文件格式暂不支持预览")}</p>;
}

export function FilePreviewLink({ path, children, context }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !context?.agent || !context?.sid) return;
    let cancelled = false;
    setFile(null);
    setError("");
    const query = new URLSearchParams({
      path,
      sessionId: context.sid,
      ...(context.before ? { before: context.before } : {}),
    });
    api(`/${context.agent}/files/preview?${query}`)
      .then((value) => {
        if (!cancelled) setFile(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, context?.agent, context?.sid, context?.before, path]);
  if (!context?.sid) return <span>{children}</span>;
  return (
    <>
      <button
        className="chat-file-link"
        type="button"
        onClick={() => setOpen(true)}
      >
        <File size={14} aria-hidden="true" />
        {children}
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setFile(null);
        }}
      >
        <DialogContent
          className="connection-dialog file-preview-dialog"
          closeLabel={t("关闭预览")}
          aria-describedby={undefined}
        >
          <DialogTitle>{file?.name || path.split("/").at(-1)}</DialogTitle>
          <DialogDescription className="file-preview-meta">
            {file ? `${(file.size / 1024).toFixed(1)} KB` : t("加载中…")}
          </DialogDescription>
          <div className="file-preview-body">
            {error ? (
              <p role="alert">{error}</p>
            ) : file ? (
              <PreviewBody file={file} />
            ) : (
              <LoaderCircle className="spin" aria-label={t("加载中…")} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
