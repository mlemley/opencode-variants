import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { localCatalog, normalizeRemote, mergeCatalog, refreshCatalog, loadCatalog, discoverCatalog, cleanEnvForProbe, parseLive } from "../src/catalog.js";
import { stateFile } from "../src/store.js";

const fixture = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "amc-cat-"));
  const f = path.join(d, "opencode.json");
  fs.writeFileSync(f, JSON.stringify({
    provider: {
      acme: {
        models: {
          "big": {
            id: "big",
            name: "Big",
            limit: { context: 262144, output: 32000 },
            cost: { input: 1, output: 4 },
            variants: { medium: { extra_body: {} }, fast: { extra_body: {} } },
          },
        },
      },
      "beta": { models: { "fast": { name: "beta fast" } } },
    },
  }));
  return f;
};

test("localCatalog normalizes models from an opencode.json file", () => {
  const out = localCatalog(fixture());
  const q = out.find((m) => m.ref === "acme/big");
  assert.equal(q.name, "Big");
  assert.equal(q.context, 262144);
  assert.equal(q.output, 32000);
  assert.deepEqual(q.variants, ["medium", "fast"]);
  assert.deepEqual(q.cost, { input: 1, output: 4 });
  assert.deepEqual(q.variantDefs.medium, { extra_body: {} });
});

test("normalizeRemote reads providers->models from the registry payload", () => {
  const out = normalizeRemote({
    providers: { anthropic: { models: { "fable-5": { name: "Fable", limit: { context: 200000, output: 64000 }, cost: { input: 10, output: 60 } } } } },
  });
  assert.deepEqual(out, [{
    ref: "anthropic/fable-5", name: "Fable", context: 200000, output: 64000, cost: { input: 10, output: 60 }, variants: [], variantDefs: null,
  }]);
});

test("mergeCatalog prefers local entries without letting nulls clobber remote metadata", () => {
  const merged = mergeCatalog(
    [{ ref: "a/b", name: "local", context: null, output: null, cost: null, variants: ["fast"], variantDefs: { fast: {} } }],
    [{ ref: "a/b", name: "remote", context: 1, output: 1, cost: { input: 3 }, variants: [], variantDefs: null }],
  );
  assert.equal(merged[0].name, "local");
  assert.equal(merged[0].context, 1);
  assert.deepEqual(merged[0].cost, { input: 3 });
  assert.deepEqual(merged[0].variants, ["fast"]);
});

test("refreshCatalog caches to models.json and survives offline", async () => {
  const env = { AMC_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-catstate-")) };
  const merged = await refreshCatalog({
    env,
    fetchFn: () => Promise.reject(new Error("offline")),
    opencodeJson: fixture(),
  });
  assert.ok(merged.some((m) => m.ref === "acme/big"));
  assert.ok(fs.existsSync(stateFile(env, "models.json")));
  const again = loadCatalog({ env, opencodeJson: fixture() });
  assert.ok(again.some((m) => m.ref === "beta/fast"));
});

test("discoverCatalog merges live `opencode models` refs without clobbering known metadata", async () => {
  const env = { AMC_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-catstate-")) };
  const out = await discoverCatalog({
    env,
    run: async () => "anthropic/fable-5\nacme/big\n",
    opencodeJson: fixture(),
  });
  assert.ok(out.some((m) => m.ref === "anthropic/fable-5"), "live-only ref included");
  assert.equal(
    out.find((m) => m.ref === "acme/big").name,
    "Big",
    "config metadata preserved for refs opencode also reports",
  );
});

test("discoverCatalog falls back to cache + configs when opencode is unavailable", async () => {
  const env = { AMC_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-catstate-")) };
  const out = await discoverCatalog({
    env,
    run: async () => { throw new Error("ENOENT"); },
    opencodeJson: fixture(),
  });
  assert.ok(out.some((m) => m.ref === "acme/big"));
});

test("cleanEnvForProbe drops the injected config but keeps everything else", () => {
  const out = cleanEnvForProbe({ HOME: "/h", AMC_HOME: "/a", OPENCODE_CONFIG_CONTENT: "{...}" });
  assert.deepEqual(out, { HOME: "/h", AMC_HOME: "/a" });
});

test("discoverCatalog probes opencode without the injected config content", async () => {
  const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amc-probestub-")), "oc");
  fs.writeFileSync(
    stub,
    '#!/bin/sh\nif [ -n "${OPENCODE_CONFIG_CONTENT:-}" ]; then echo "sentinel/LEAKED"; else echo "sentinel/CLEAN"; fi\n',
  );
  fs.chmodSync(stub, 0o755);
  const out = await discoverCatalog({
    env: {
      AMC_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-catstate-")),
      AMC_OPENCODE_BIN: stub,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { plan: { model: "acme/big" } } }),
    },
    opencodeJson: fixture(),
  });
  assert.ok(out.some((m) => m.ref === "sentinel/CLEAN"), "probe saw a sanitized env");
  assert.ok(!out.some((m) => m.ref === "sentinel/LEAKED"));
});

test("parseLive handles verbose ref+JSON pairs", () => {
  const raw = [
    "acme/big",
    "{",
    '  "name": "Big",',
    '  "limit": { "context": 200000, "output": 32000 },',
    '  "cost": { "input": 0, "output": 0 },',
    '  "variants": { "high": { "reasoningEffort": "high" }, "low": {} }',
    "}",
    "beta/quick",
    "{",
    '  "name": "Quick"',
    "}",
  ].join("\n");
  const out = parseLive(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    ref: "acme/big",
    name: "Big",
    context: 200000,
    output: 32000,
    cost: { input: 0, output: 0 },
    variants: ["high", "low"],
    variantDefs: { high: { reasoningEffort: "high" }, low: {} },
  });
  assert.deepEqual(out[1].variants, []);
});

test("parseLive falls back to plain refs (older opencode) and survives bad JSON", () => {
  assert.deepEqual(parseLive("a/x\nb/y\n"), [{ ref: "a/x" }, { ref: "b/y" }]);
  const broken = "a/x\n{\n  oops not json\n}\nb/y\n";
  assert.deepEqual(parseLive(broken).map((m) => m.ref), ["a/x", "b/y"]);
  const unclosed = "a/x\n{\n  \"name\": \"X\"\nb/y\n";
  assert.deepEqual(parseLive(unclosed).map((m) => m.ref), ["a/x", "b/y"]);
});
