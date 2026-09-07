import test from "node:test";
import assert from "node:assert/strict";
import { interviewPlan, placementFor, slotFor, answersToVariant, providersOf, parseDeny, parseLimits, parseIntent, resolveEditAnswer } from "../src/wizard.js";

const INTENTS = ["all-cloud", "hybrid", "all-local"];

test("parseIntent: empty selects hybrid default", () => {
  assert.equal(parseIntent("", INTENTS), "hybrid");
  assert.equal(parseIntent("   ", INTENTS), "hybrid");
});

test("parseIntent: number selects from list", () => {
  assert.equal(parseIntent("1", INTENTS), "all-cloud");
  assert.equal(parseIntent(" 2 ", INTENTS), "hybrid");
  assert.equal(parseIntent("3", INTENTS), "all-local");
});

test("parseIntent: name accepted case-insensitively", () => {
  assert.equal(parseIntent("all-cloud", INTENTS), "all-cloud");
  assert.equal(parseIntent("All-Local", INTENTS), "all-local");
});

test("parseIntent: invalid input returns null (caller re-asks)", () => {
  assert.equal(parseIntent("0", INTENTS), null);
  assert.equal(parseIntent("4", INTENTS), null);
  assert.equal(parseIntent("cloud", INTENTS), null);
  assert.equal(parseIntent("garbage", INTENTS), null);
});

test("interviewPlan lists roles with current model and mode", () => {
  assert.deepEqual(
    interviewPlan({ plan: { model: "m1", variant: "high" }, scout: { mode: "subagent" } }),
    [
      { role: "plan", current: "m1", mode: null, defaultVariant: "high" },
      { role: "scout", current: null, mode: "subagent", defaultVariant: null },
    ],
  );
});

test("placementFor follows the spec placement table", () => {
  assert.deepEqual(placementFor("all-cloud", "plan"), { pick: "reasoning", concrete: true });
  assert.deepEqual(placementFor("all-cloud", "build"), { pick: "reasoning", concrete: true });
  assert.deepEqual(placementFor("hybrid", "plan"), { pick: "reasoning", concrete: true });
  assert.deepEqual(placementFor("hybrid", "build"), { pick: "reasoning", concrete: false });
  assert.deepEqual(placementFor("all-local", "plan"), { pick: "reasoning", concrete: false });
  assert.deepEqual(placementFor("all-cloud", "executor"), { pick: "fast", concrete: false });
  assert.equal(placementFor("hybrid", "scout"), null);
  assert.equal(placementFor("bogus", "plan"), null);
});

test("slotFor maps picks to slot names", () => {
  assert.equal(slotFor("reasoning"), "model-reasoning");
  assert.equal(slotFor("fast"), "model-fast");
});

test("answersToVariant builds the document, validates the name, embeds restrictions", () => {
  const v = answersToVariant({
    name: "my-tier", tier: "hybrid", description: "d",
    answers: [
      { role: "plan", slot: "model-reasoning", variant: "medium" },
      { role: "executor", model: "prov/fast", variant: undefined },
    ],
    denyProviders: ["openai"],
    limits: { prov: { allow: ["m1"] } },
  });
  assert.equal(v.name, "my-tier");
  assert.deepEqual(v.roles.plan, { slot: "model-reasoning", variant: "medium" });
  assert.deepEqual(v.roles.executor, { model: "prov/fast" });
  assert.deepEqual(v.denyProviders, ["openai"]);
  assert.deepEqual(v.limits, { prov: { allow: ["m1"] } });
  assert.throws(
    () => answersToVariant({ name: "Bad Name", tier: "x", description: "", answers: [] }),
    /invalid variant name/,
  );
});

test("answersToVariant omits empty restrictions", () => {
  const v = answersToVariant({
    name: "a", tier: "cloud", description: "",
    answers: [{ role: "plan", model: "x/y" }],
  });
  assert.equal("denyProviders" in v, false);
  assert.equal("limits" in v, false);
});

test("providersOf lists detected providers, sorted and unique", () => {
  assert.deepEqual(providersOf([{ ref: "b/1" }, { ref: "a/2" }, { ref: "a/1" }]), ["a", "b"]);
});

test("parseDeny handles lists and only: emulation", () => {
  assert.deepEqual(parseDeny("", ["a", "b"]), []);
  assert.deepEqual(parseDeny(" b , ", ["a", "b"]), ["b"]);
  assert.deepEqual(parseDeny("only:a", ["a", "b", "c"]), ["b", "c"]);
});

test("parseLimits parses only/except clauses", () => {
  assert.deepEqual(
    parseLimits("a=only:m1,m2; b=except:m3"),
    { a: { allow: ["m1", "m2"] }, b: { deny: ["m3"] } },
  );
  assert.deepEqual(parseLimits(""), {});
  assert.throws(() => parseLimits("a=only:"), /bad limit/);
});

test("prototype-chain keys never satisfy the placement table", () => {
  assert.equal(placementFor("hybrid", "constructor"), null);
  assert.equal(placementFor("constructor", "plan"), null);
});

test("parseDeny folds case and anchors to detected providers", () => {
  assert.deepEqual(parseDeny("B", ["a", "b"]), ["b"]);
  assert.deepEqual(parseDeny("nope", ["a"]), []);
  assert.deepEqual(parseDeny("Only:a", ["a", "b"]), ["b"]);
});

test("answersToVariant rejects answers with neither slot nor model", () => {
  assert.throws(
    () => answersToVariant({ name: "a", tier: "cloud", description: "", answers: [{ role: "p", slot: "" }] }),
    /role p: no model or slot/,
  );
});

test("parseLimits is case-insensitive on provider and keyword", () => {
  assert.deepEqual(
    parseLimits("Acme=Only:Big"),
    { acme: { allow: ["Big"] } },
  );
});

test("parseLimits accepts full provider/model refs as shorthand", () => {
  assert.deepEqual(
    parseLimits("acme=only:acme/big,small"),
    { acme: { allow: ["big", "small"] } },
  );
});

test("resolveEditAnswer: keep / clear / replace", () => {
  assert.deepEqual(resolveEditAnswer(""), { action: "keep" });
  assert.deepEqual(resolveEditAnswer("  - "), { action: "clear" });
  assert.deepEqual(resolveEditAnswer(" beta "), { action: "replace", value: "beta" });
});
