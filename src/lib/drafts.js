import { browserStorage } from "./browser-storage.js";
function record(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key + ":record"));
    if (typeof value?.text === "string" && Array.isArray(value.applied))
      return value;
  } catch {}
  try {
    return { text: storage.getItem(key) || "", applied: [] };
  } catch {
    return { text: "", applied: [] };
  }
}
export const readDraft = (key) => record(browserStorage, key).text;
export function clearWithdrawnSubmission(storage, pendingKey, receiptId) {
  let pending;
  try {
    pending = JSON.parse(storage.getItem(pendingKey));
  } catch {
    return false;
  }
  if (pending?.id !== receiptId) return false;
  return storage.removeItem(pendingKey) !== false;
}
export function writeDraft(key, text) {
  const value = record(browserStorage, key);
  return {
    saved: browserStorage.setItem(
      key + ":record",
      JSON.stringify({ ...value, text }),
    ),
  };
}
export function restoreDraft(storage, key, receipt) {
  const value = record(storage, key);
  if (value.applied.includes(receipt.receiptId))
    return { text: value.text, applied: false, saved: !storage.hasUnsaved?.() };
  const text = value.text ? value.text + "\n\n" + receipt.text : receipt.text;
  // Text and receipt identity commit together, so a reload cannot append twice.
  const saved =
    storage.setItem(
      key + ":record",
      JSON.stringify({ text, applied: [...value.applied, receipt.receiptId] }),
    ) !== false;
  return { text, applied: true, hadDraft: !!value.text, saved };
}
