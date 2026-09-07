import test from "node:test";
import assert from "node:assert/strict";
import { resolveRolesFor, generateConfig, renderEnvrc, markerHash, contentHash } from "../src/generate.js";

test("resolveRolesFor swaps slots for concrete models", () => {
  const out = resolveRolesFor(
    { roles: { plan: { slot: "model-reasoning", variant: "medium" }, utility: { model: "prov/small" } } },
    { "model-reasoning": "prov/big" },
  );
  assert.deepEqual(out.plan, { model: "prov/big", variant: "medium" });
  assert.deepEqual(out.utility, { model: "prov/small" });
});

test("resolveRolesFor gives an actionable error for unset slots and missing models", () => {
  assert.throws(
    () => resolveRolesFor({ roles: { plan: { slot: "model-fast" } } }, { "model-fast": null }),
    /role plan: slot model-fast is not set \(models set model-fast <provider\/model>\)/,
  );
  assert.throws(() => resolveRolesFor({ roles: { plan: {} } }, {}), /role plan: no model set/);
});

test("generateConfig emits only the agent block by default", () => {
  assert.deepEqual(
    generateConfig({ roles: { plan: { model: "prov/x" } } }, {}),
    { agent: { plan: { model: "prov/x" } } },
  );
});

test("generateConfig adds restriction keys only when the variant declares them", () => {
  const cfg = generateConfig(
    {
      roles: { plan: { model: "prov/x" } },
      denyProviders: ["gone"],
      limits: { prov: { allow: ["x"], deny: ["y"] } },
    },
    {},
  );
  assert.deepEqual(cfg.disabled_providers, ["gone"]);
  assert.deepEqual(cfg.provider.prov, { whitelist: ["x"], blacklist: ["y"] });
  assert.deepEqual(cfg.agent, { plan: { model: "prov/x" } });
});

test("empty restriction fields produce no provider/disabled_providers keys", () => {
  const cfg = generateConfig(
    { roles: { plan: { model: "prov/x" } }, denyProviders: [], limits: {} },
    {},
  );
  assert.deepEqual(cfg, { agent: { plan: { model: "prov/x" } } });
});

test("renderEnvrc marker round-trips; hand-edit breaks the hash match", () => {
  const text = renderEnvrc({ agent: {} }, { variantName: "t", cwd: "/d" });
  assert.match(text, /^# managed-by: opencode-variants t @[0-9a-f]{64}\n/);
  assert.match(text, /PATH_add '\/d\/bin'/);
  assert.equal(markerHash(text), contentHash(text));
  const edited = text.replace('"agent": {}', '"agent": {"x":1}');
  assert.notEqual(markerHash(edited), contentHash(edited));
});

test("renderEnvrc output sources correctly and cannot inject commands", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const cfg = { agent: { "it's": { model: "a'b/c" } } };
  const cwd = "/d d'; touch /tmp/amc-shq-PWNED";
  const text = renderEnvrc(cfg, { variantName: "t", cwd });
  assert.ok(text.includes(`'\\''`), "apostrophes escaped POSIX-style");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amc-shq-"));
  const f = path.join(dir, ".envrc");
  fs.writeFileSync(f, text);
  const probe = path.join(dir, "PWNED");
  const src = `PATH_add(){ :; }\nT='${dir}'\n. '${f}'\nprintf %s "$OPENCODE_CONFIG_CONTENT"`;
  const got = execFileSync("bash", ["-c", src], { encoding: "utf8" });
  assert.equal(got, JSON.stringify(cfg, null, 2));
  assert.equal(fs.existsSync(probe), false, "no command injection");
  assert.equal(fs.existsSync("/tmp/amc-shq-PWNED"), false, "no command injection");
  assert.equal(markerHash(text), contentHash(text));
});

test("prototype-chain slot names never resolve", () => {
  assert.throws(
    () => resolveRolesFor({ roles: { plan: { slot: "constructor" } } }, {}),
    /slot constructor is not set/,
  );
});
