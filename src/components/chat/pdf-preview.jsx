import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../ui/button";
import { t } from "../../lib/i18n";
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ base64 }) {
  const canvas = useRef(null);
  const [document, setDocument] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const task = getDocument({
      data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      isEvalSupported: false,
    });
    task.promise
      .then((doc) => {
        if (!disposed) setDocument(doc);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [base64]);
  useEffect(() => {
    if (!document) return;
    let disposed = false,
      render;
    document
      .getPage(page)
      .then((pdfPage) => {
        if (disposed) return;
        const el = canvas.current;
        const initial = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({
          scale: Math.min(2, 1100 / initial.width, 1600 / initial.height),
        });
        el.width = Math.ceil(viewport.width);
        el.height = Math.ceil(viewport.height);
        render = pdfPage.render({
          canvasContext: el.getContext("2d"),
          viewport,
        });
        return render.promise;
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [document, page]);
  if (error)
    return (
      <p role="alert">
        {t("PDF 预览失败：")}
        {error}
      </p>
    );
  return (
    <div className="pdf-preview">
      <div className="pdf-preview-controls">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("上一页")}
          disabled={!document || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={18} />
        </Button>
        <span>
          {document ? `${page} / ${document.numPages}` : t("加载中…")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("下一页")}
          disabled={!document || page >= document.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={18} />
        </Button>
      </div>
      <canvas ref={canvas} aria-label={t("PDF 页面")} />
    </div>
  );
}
