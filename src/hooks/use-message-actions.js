import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { browserStorage as storage } from "../lib/browser-storage";
import { t } from "../lib/i18n.js";
import { requestId } from "../lib/session";
import { approvalAnswerKey } from "../lib/approval-answers";
import {
  clearWithdrawnSubmission,
  restoreDraft,
  writeDraft,
} from "../lib/drafts";

// Sending, answering approvals/questions, and withdrawing queued messages.
// A send first persists the draft and a receipt (request id + signature) so
// an interrupted send retries with the same id; a withdraw persists its
// receipt so a reload finishes it and restores the withdrawn text.
export function useMessageActions({
  agent,
  sid,
  setSid,
  project,
  agents,
  active,
  draft,
  draftRef,
  setDraft,
  textareaRef,
  pendingSend,
  busy,
  setBusy,
  setError,
  setDetail,
  setNav,
  nearBottom,
  answers,
  setAnswers,
  effort,
  setEffort,
  modelChoice,
  setModelChoice,
  setModelRefresh,
  storageUnavailable,
}) {
  const queueActions = useRef(new Set());
  useEffect(() => {
    if (!sid || storageUnavailable) return;
    const pending = storage.getItem("withdraw:" + agent + ":" + sid);
    if (pending)
      void queueAction(
        {
          requestId: pending,
        },
        "withdraw",
      );
  }, [agent, sid, storageUnavailable]);
  async function queueAction(item, action) {
    const context = {
      agent,
      sid,
    };
    const identity = JSON.stringify([agent, sid, item.requestId, action]);
    if (queueActions.current.has(identity)) return;
    queueActions.current.add(identity);
    const pendingKey = "withdraw:" + agent + ":" + sid;
    try {
      if (
        action === "withdraw" &&
        storage.getItem(pendingKey) &&
        storage.getItem(pendingKey) !== item.requestId
      )
        throw Error(t("上一条撤回结果尚待恢复，请重新打开此会话后继续"));
      if (action === "withdraw")
        if (!storage.setItem(pendingKey, item.requestId))
          throw Error(
            t("无法保存撤回回执，消息尚未撤回；请恢复浏览器存储后重试"),
          );
      const result = await api(
        "/" +
          agent +
          "/sessions/" +
          encodeURIComponent(sid) +
          "/queue/" +
          encodeURIComponent(item.requestId) +
          "/" +
          action,
        {},
      );
      const same =
        active.current.agent === context.agent &&
        active.current.sid === context.sid;
      if (action === "withdraw") {
        const key = "draft:" + context.agent + ":" + context.sid;
        const restored = restoreDraft(storage, key, {
          ...result,
          receiptId: result.receiptId || item.requestId,
        });
        clearWithdrawnSubmission(
          storage,
          "pending-send:" + context.agent + ":" + context.sid,
          result.receiptId || item.requestId,
        );
        if (
          same &&
          pendingSend.current?.id === (result.receiptId || item.requestId)
        )
          pendingSend.current = null;
        if (same) {
          draftRef.current = restored.text;
          setDraft(restored.text);
          if (restored.applied && !restored.hadDraft && result.model) {
            setModelChoice(result.model.id || "");
            setEffort(result.model.effort || "");
          }
          textareaRef.current?.focus({
            preventScroll: true,
          });
        }
      }
      if (action === "withdraw" && !storage.hasUnsaved())
        storage.removeItem(pendingKey);
      if (same)
        setDetail((d) =>
          d
            ? {
                ...d,
                queue: d.queue.filter((x) => x.requestId !== item.requestId),
              }
            : d,
        );
    } catch (e) {
      if (e.status && e.status < 500) storage.removeItem(pendingKey);
      if (
        active.current.agent === context.agent &&
        active.current.sid === context.sid
      )
        setError(e.message);
    } finally {
      queueActions.current.delete(identity);
    }
  }
  async function send() {
    if (
      !draft.trim() ||
      busy ||
      !project ||
      agents.find((a) => a.id === agent)?.capabilities?.reply === false
    )
      return;
    const context = {
      agent,
      sid,
      projectId: project.id,
      text: draft,
      ...(effort
        ? {
            effort,
          }
        : {}),
      ...(modelChoice
        ? {
            modelId: modelChoice,
          }
        : {}),
    };
    setBusy(true);
    setError("");
    const signature = JSON.stringify(context);
    const pendingKey = "pending-send:" + agent + ":" + (sid || project.id);
    try {
      pendingSend.current = JSON.parse(storage.getItem(pendingKey));
    } catch {
      pendingSend.current = null;
    }
    if (pendingSend.current?.signature !== signature)
      pendingSend.current = {
        signature,
        id: requestId(),
      };
    try {
      if (
        !writeDraft("draft:" + agent + ":" + (sid || project.id), draft).saved
      )
        throw Error(t("草稿尚未保存，消息尚未发送；请恢复浏览器存储后重试"));
      if (!storage.setItem(pendingKey, JSON.stringify(pendingSend.current)))
        throw Error(
          t("本地存储不可用，无法保存发送回执；消息尚未发送，输入内容已保留"),
        );
      const result = await api(
        "/" +
          agent +
          "/sessions" +
          (sid ? "/" + encodeURIComponent(sid) + "/messages" : ""),
        {
          text: draft,
          ...(effort
            ? {
                effort,
              }
            : {}),
          projectId: project.id,
          requestId: pendingSend.current.id,
          ...(modelChoice
            ? {
                modelId: modelChoice,
              }
            : {}),
        },
      );
      if (active.current.agent !== context.agent) return;
      if (result.error) {
        setError(result.error);
        // Stay in the creation context and preserve its request identity.
        // Retrying resumes the creation checkpoint, not a new-session send.
        return;
      }
      const remaining =
        draftRef.current === context.text ? "" : draftRef.current;
      draftRef.current = remaining;
      setDraft(remaining);
      const cleared = writeDraft(
        "draft:" + context.agent + ":" + (context.sid || context.projectId),
        "",
      ).saved;
      if (remaining)
        writeDraft(
          "draft:" +
            context.agent +
            ":" +
            (result.id || context.sid || context.projectId),
          remaining,
        );
      setModelChoice("");
      setEffort("");
      setModelRefresh((x) => x + 1);
      pendingSend.current = null;
      if (cleared) storage.removeItem(pendingKey);
      if (result.id) setSid(result.id);
      else {
        const d = await api(
          "/" + agent + "/sessions/" + encodeURIComponent(sid),
        );
        setDetail(d);
      }
      nearBottom.current = true;
      setNav(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function answer(p, allow) {
    const context = { agent, sid };
    const key = approvalAnswerKey(agent, sid, p.id);
    setBusy(true);
    try {
      await api(
        "/" +
          agent +
          "/sessions/" +
          encodeURIComponent(sid) +
          "/answers/" +
          encodeURIComponent(p.id),
        {
          allow,
          answers: answers[key] || {},
        },
      );
      setAnswers((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      const d = await api("/" + agent + "/sessions/" + encodeURIComponent(sid));
      if (
        active.current.agent === context.agent &&
        active.current.sid === context.sid
      ) {
        setDetail(d);
        setError("");
      }
    } catch (e) {
      if (
        active.current.agent === context.agent &&
        active.current.sid === context.sid
      )
        setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { send, answer, queueAction };
}
