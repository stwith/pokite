import test from "node:test";
import assert from "node:assert/strict";
import { selectModelSettings } from "../server/model-settings.mjs";
test("model and effort use one catalog snapshot without mutating provider metadata", async () => {
  let calls = 0;
  const model = { id: "m", model: "native-m", efforts: ["high"] };
  const adapter = {
    models: async () => {
      calls++;
      return { options: [model], current: "m", canSwitch: true };
    },
  };
  assert.deepEqual(
    await selectModelSettings(adapter, {}, "s", {
      modelId: "m",
      effort: "high",
    }),
    { ...model, effort: "high" },
  );
  assert.equal(calls, 1);
  assert.equal(model.effort, undefined);
  await assert.rejects(
    selectModelSettings(adapter, {}, "s", { effort: "ultra" }),
    { status: 400 },
  );
});
test("defaults skip catalog work and unsupported switching fails before dispatch", async () => {
  const adapter = {
    models: async () => ({
      options: [{ id: "m" }],
      current: "m",
      canSwitch: false,
    }),
  };
  assert.equal(await selectModelSettings({}, {}, "s", {}), undefined);
  await assert.rejects(
    selectModelSettings(adapter, {}, "s", { modelId: "other" }),
    { status: 409 },
  );
  await assert.rejects(selectModelSettings(adapter, {}, "s", { modelId: {} }), {
    status: 400,
  });
});
