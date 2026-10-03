import { t } from "../../lib/i18n.js";
import { ComposerButton } from "../chat/controls";
import { ArrowDown, LoaderCircle, Send, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { attachmentMarkdown } from "../../../shared/file-references.mjs";
import { Textarea } from "@/components/ui/textarea";
import { CompactSelect } from "@/components/ui/compact-select";
export function ChatComposer({
  sid,
  detail,
  showLatest,
  textareaRef,
  scroller,
  modelError,
  send,
  draft,
  project,
  selectedAgent,
  draftChange,
  modelChoice,
  modelCatalog,
  busy,
  setModelChoice,
  setEffort,
  effort,
}) {
  const fileInput = useRef(null);
  const latest = useRef({ draft, draftChange, scope: "" });
  const scope = JSON.stringify([selectedAgent?.id, sid, project?.id]);
  latest.current = { draft, draftChange, scope };
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const unavailable =
    !project ||
    selectedAgent?.capabilities?.reply === false ||
    detail?.readOnly ||
    (!sid && project.canCreate === false);
  useEffect(() => {
    setUploadError("");
  }, [scope]);
  async function uploadFiles(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length || uploading || unavailable) return;
    const context = latest.current.scope;
    setUploading(true);
    setUploadError("");
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024)
          throw Error(t("单个文件不能超过 20 MB"));
        if (!file.size) throw Error(t("文件为空或格式无效"));
        const query = new URLSearchParams({
          name: file.name,
          ...(sid ? { sessionId: sid } : { projectId: project.id }),
        });
        const result = await api(
          `/${selectedAgent.id}/files/upload?${query}`,
          file,
          { binary: true },
        );
        if (latest.current.scope !== context) return;
        const value = latest.current.draft;
        const next =
          value +
          (value && !value.endsWith("\n") ? "\n" : "") +
          attachmentMarkdown(result) +
          "\n";
        latest.current.draft = next;
        latest.current.draftChange(next);
      }
    } catch (error) {
      if (latest.current.scope === context) setUploadError(error.message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="composer-wrap">
      {sid && detail && showLatest && (
        <ComposerButton
          inputRef={textareaRef}
          variant="outline"
          size="icon"
          className="jump-to-latest"
          aria-label={t("回到最新消息")}
          onPress={() => {
            const el = scroller.current;
            if (!el) return;
            el.scrollTo({
              top: el.scrollHeight,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            });
          }}
        >
          <ArrowDown size={19} aria-hidden="true" />
        </ComposerButton>
      )}
      {detail?.readOnlyReason && (
        <p className="model-error">{detail.readOnlyReason}</p>
      )}
      {modelError && (
        <p className="model-error" role="status">
          {t("模型列表暂不可用 ·")}
          {modelError}
        </p>
      )}
      {uploadError && (
        <p className="model-error" role="alert">
          {uploadError}
        </p>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!uploading) send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label={t("选择照片或文件")}
          onChange={uploadFiles}
        />
        <div className="composer-input">
          <ComposerButton
            inputRef={textareaRef}
            onPress={() => fileInput.current?.click()}
            variant="ghost"
            size="icon-sm"
            className="composer-attach"
            aria-label={t("添加照片或文件")}
            disabled={busy || uploading || unavailable}
            aria-busy={uploading}
          >
            {uploading ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Paperclip size={16} />
            )}
          </ComposerButton>
          <Textarea
            ref={textareaRef}
            aria-label={t("消息")}
            placeholder={sid ? t("回复…") : t("描述你想完成的任务…")}
            value={draft}
            disabled={unavailable}
            onChange={(e) => draftChange(e.target.value)}
            enterKeyHint="enter"
          />
        </div>
        <div className="composer-bottom">
          <div className="composer-actions">
            <div className="model-picker">
              <CompactSelect
                label={t("模型")}
                value={modelChoice || modelCatalog?.current || ""}
                defaultOption={
                  !modelCatalog?.options.some(
                    (m) => m.id === (modelChoice || modelCatalog.current),
                  )
                }
                disabled={busy || !modelCatalog?.canSwitch}
                onChange={(value) => {
                  setModelChoice(value);
                  setEffort(
                    modelCatalog?.options.find((m) => m.id === value)
                      ?.defaultEffort || "",
                  );
                }}
                placeholder={
                  modelCatalog?.options.find(
                    (m) => m.id === modelCatalog.current,
                  )?.label ||
                  detail?.model ||
                  t("默认模型")
                }
                options={modelCatalog?.options || []}
              />
            </div>
            {!!modelCatalog?.options.find(
              (m) => m.id === (modelChoice || modelCatalog.current),
            )?.efforts?.length && (
              <div className="effort-picker">
                <CompactSelect
                  label={t("推理强度")}
                  value={effort || modelCatalog.currentEffort || ""}
                  defaultOption={
                    !modelCatalog.options
                      .find(
                        (m) => m.id === (modelChoice || modelCatalog.current),
                      )
                      ?.efforts.includes(effort || modelCatalog.currentEffort)
                  }
                  onChange={setEffort}
                  placeholder={modelCatalog.currentEffort || t("默认强度")}
                  options={modelCatalog.options
                    .find((m) => m.id === (modelChoice || modelCatalog.current))
                    .efforts.map((e) => ({
                      id: e,
                      label: e,
                    }))}
                />
              </div>
            )}
            <ComposerButton
              inputRef={textareaRef}
              onPress={() => {
                if (!uploading) send();
              }}
              size="icon"
              className="send"
              aria-label={t("发送")}
              aria-busy={busy}
              disabled={
                busy ||
                uploading ||
                selectedAgent?.capabilities?.reply === false ||
                !draft.trim() ||
                !project ||
                (sid && (!detail || detail.readOnly))
              }
            >
              {busy ? (
                <LoaderCircle size={17} strokeWidth={2} className="spin" />
              ) : (
                <Send size={17} strokeWidth={2} />
              )}
            </ComposerButton>
          </div>
        </div>
      </form>
    </div>
  );
}
