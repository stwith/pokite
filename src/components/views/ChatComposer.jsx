import { t } from "../../lib/i18n.js";
import { ComposerButton } from "../chat/controls";
import { ArrowDown, LoaderCircle, Send } from "lucide-react";
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
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          ref={textareaRef}
          aria-label={t("消息")}
          placeholder={sid ? t("回复…") : t("描述你想完成的任务…")}
          value={draft}
          disabled={
            !project ||
            selectedAgent?.capabilities?.reply === false ||
            detail?.readOnly ||
            (!sid && project.canCreate === false)
          }
          onChange={(e) => draftChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
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
              onPress={send}
              size="icon"
              className="send"
              aria-label={t("发送")}
              aria-busy={busy}
              disabled={
                busy ||
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
