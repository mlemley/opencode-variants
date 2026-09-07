import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { variantNames, loadVariant, saveVariant, resolveVariant, nearestStoreDir, assertVariantName } from "../src/variants.js";

const freshEnv = () => ({ OV_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-variants-")) });
// neutral cwd: tmp-based, so ancestors can never contain a real .opencode-variants/variants
const neutralCwd = () => fs.mkdtempSync(path.join(os.tmpdir(), "amc-cwd-"));

test("fresh store lists no variants (nothing is seeded)", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "amc-cwd-"));
  assert.deepEqual(variantNames(freshEnv(), cwd), []);
  assert.equal(loadVariant("hybrid", freshEnv(), cwd), null);
});

test("saveVariant/loadVariant round-trip (name becomes the filename, and re-attaches on load)", () => {
  const env = freshEnv();
  saveVariant({
    name: "my-tier",
    tier: "cloud",
    description: "always big",
    roles: { plan: { model: "prov/big", variant: "xhigh" } },
  }, env);
  assert.deepEqual(loadVariant("my-tier", env, neutralCwd()), {
    name: "my-tier",
    tier: "cloud",
    description: "always big",
    roles: { plan: { model: "prov/big", variant: "xhigh" } },
  });
  assert.deepEqual(variantNames(env, neutralCwd()), ["my-tier"]);
});

test("restriction fields survive the round-trip", () => {
  const env = freshEnv();
  saveVariant({
    name: "locked", tier: "cloud", description: "",
    roles: { plan: { model: "prov/x" } },
    denyProviders: ["gone"], limits: { prov: { allow: ["x"] } },
  }, env);
  const v = loadVariant("locked", env, neutralCwd());
  assert.deepEqual(v.denyProviders, ["gone"]);
  assert.deepEqual(v.limits, { prov: { allow: ["x"] } });
});

test("shape-broken variant docs load as null (hand-edit protection)", () => {
  const env = freshEnv();
  saveVariant({ name: "noroles", description: "d" }, env);
  assert.equal(loadVariant("noroles", env, neutralCwd()), null);
  fs.writeFileSync(path.join(env.OV_HOME, "variants", "nullrole.json"), JSON.stringify({ roles: { plan: null } }));
  assert.equal(loadVariant("nullrole", env, neutralCwd()), null);
});

test("tree-scoped variants shadow the global store; resolution walks up", () => {
  const env = freshEnv();
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const deep = path.join(tree, "work", "proj");
  fs.mkdirSync(deep, { recursive: true });
  saveVariant({ name: "hybrid", tier: "cloud", description: "global", roles: { plan: { model: "prov/global" } } }, env);
  saveVariant({
    name: "hybrid", tier: "hybrid", description: "work tree",
    roles: { plan: { model: "copilot/premium" } },
  }, env, tree);

  const r = resolveVariant("hybrid", env, deep);
  assert.equal(r.variant.description, "work tree");
  assert.equal(r.scope, tree);
  assert.equal(loadVariant("hybrid", env, tree).description, "work tree");
  assert.equal(loadVariant("hybrid", env, fs.mkdtempSync(path.join(os.tmpdir(), "amc-cwd-"))).description, "global");
  assert.deepEqual(variantNames(env, deep), ["hybrid"]);

  // a broken shadowing file is an error, not a silent fall-through to global
  fs.writeFileSync(path.join(tree, ".opencode-variants", "variants", "hybrid.json"), "{ broken");
  assert.equal(loadVariant("hybrid", env, deep), null);
});

test("nearestStoreDir finds the tree's variant store", () => {
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const deep = path.join(tree, "a", "b");
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(path.join(tree, ".opencode-variants", "variants"), { recursive: true });
  assert.equal(nearestStoreDir(deep), tree);
  assert.equal(nearestStoreDir(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-bare-")))), null);
});

test("reserved subcommand names are rejected at save time", () => {
  assert.throws(() => assertVariantName("use"), /ov subcommand/);
  assert.throws(() => assertVariantName("serve"), /ov subcommand/);
  assert.doesNotThrow(() => assertVariantName("hybrid"));
  const env = freshEnv();
  assert.throws(() => saveVariant({ name: "status", roles: {} }, env), /ov subcommand/);
});
