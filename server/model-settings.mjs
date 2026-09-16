export async function selectModelSettings(adapter, project, sessionId, body) {
  const id = body.modelId;
  const hasModel = id !== undefined && id !== null && id !== "";
  if (!hasModel && !body.effort) return undefined;
  if (hasModel && (typeof id !== "string" || id.length > 500))
    throw Object.assign(Error("Invalid model"), { status: 400 });

  // Validate model and effort against the same native catalog snapshot.
  const catalog = await adapter.models(project, sessionId);
  if (hasModel && sessionId && !catalog.canSwitch && id !== catalog.current)
    throw Object.assign(
      Error(catalog.reason || "Model switching unsupported"),
      { status: 409 },
    );
  let model = catalog.options.find(
    (option) => option.id === (hasModel ? id : catalog.current),
  );
  if (hasModel && !model)
    throw Object.assign(Error("所选模型不在当前 Agent 的可用列表中"), {
      status: 400,
    });
  if (body.effort) {
    if (!model?.efforts?.includes(body.effort))
      throw Object.assign(Error("当前模型不支持所选推理强度"), { status: 400 });
    model = { ...model, effort: body.effort };
  }
  return model;
}
