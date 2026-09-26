export function parseClaudeModels(value, current = {}) {
  const entry =
    value.model_selector_config?.find((x) => x.id === "cowork") ||
    value.model_selector_config?.find((x) => x.id === "chat");
  const state = value.model_selector_state?.find((x) => x.id === entry?.id);
  if (!Array.isArray(entry?.models))
    throw Object.assign(Error("Claude 模型列表不可用"), { status: 503 });
  const options = entry.models
    .filter(
      (m) =>
        typeof m.id === "string" && !m.disabled && m.section !== "deprecated",
    )
    .map((m) => {
      const levels = (m.thinking?.effort_options || []).filter(
        (e) => typeof e.id === "string" && !e.disabled,
      );
      const preference = state?.thinking_by_model?.find((x) => x.id === m.id)
        ?.thinking?.effort;
      const desired = preference;
      return {
        id: m.id,
        label: typeof m.name === "string" ? m.name : m.id,
        efforts: levels.map((e) => e.id),
        defaultEffort:
          levels.find((e) => e.id === desired)?.id ||
          levels.find((e) => e.recommended)?.id ||
          levels[0]?.id,
      };
    });
  const id = current.model || state?.model || options[0]?.id || null;
  return {
    options,
    current: id,
    currentEffort:
      current.effort || options.find((m) => m.id === id)?.defaultEffort || null,
    canSwitch: true,
  };
}
export class ClaudeModels {
  constructor(client, { now = Date.now } = {}) {
    Object.assign(this, { client, now });
  }
  async get(current = {}) {
    const owner = await this.client.identity(),
      scope = owner.account + ":" + owner.organization;
    if (this.cache?.scope !== scope) this.cache = null;
    if (!this.cache || this.now() - this.cache.time >= 60000) {
      if (!this.pending || this.pending.scope !== scope) {
        const work = this.client
          .request(
            "/api/bootstrap/" +
              owner.organization +
              "/app_start?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false",
            { scope },
          )
          .then((value) => {
            parseClaudeModels(value);
            this.cache = { scope, time: this.now(), value };
            return value;
          })
          .finally(() => {
            if (this.pending?.work === work) this.pending = null;
          });
        this.pending = { scope, work };
      }
      await this.pending.work;
    }
    return parseClaudeModels(this.cache.value, current);
  }
  clear() {
    this.cache = null;
  }
}
export function settingEvents(sessionId, requestId, model, effort) {
  const events = [];
  if (model)
    events.push({
      payload: {
        type: "control_request",
        request_id: "pokite-model-" + requestId,
        request: { subtype: "set_model", model },
      },
    });
  if (effort)
    events.push({
      payload: {
        type: "control_request",
        request_id: "pokite-effort-" + requestId,
        request: {
          subtype: "apply_flag_settings",
          settings: { effortLevel: effort },
        },
      },
    });
  return { session_id: sessionId, events };
}
export function controlResult(events, ids) {
  const pending = new Set(ids);
  let error;
  for (const event of events) {
    const p = event.payload;
    if (p?.type !== "control_response") continue;
    const result = p.response;
    if (!pending.has(result?.request_id)) continue;
    if (result.subtype === "error")
      error =
        typeof result.error === "string"
          ? result.error
          : result.error?.message || "Claude 拒绝了模型或强度切换";
    else if (result.subtype === "success") pending.delete(result.request_id);
  }
  return { complete: pending.size === 0, error };
}
