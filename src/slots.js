import { readJson, writeJson, stateFile } from "./store.js";

export const DEFAULT_SLOTS = {
  "model-reasoning": null,
  "model-fast": null,
};

export function loadSlots(env = process.env) {
  return { ...DEFAULT_SLOTS, ...readJson(stateFile(env, "slots.json"), {}) };
}

export function saveSlots(slots, env = process.env) {
  writeJson(stateFile(env, "slots.json"), slots);
}
