import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BIN = new URL("../bin/ov", import.meta.url).pathname;

function makeEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amc-home-"));
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    agent: { plan: {}, build: {}, executor: {} },
  }));
  return { HOME: home, OV_HOME: path.join(home, "state"), OV_DIRENV: "/usr/bin/true", PATH: process.env.PATH };
}

function run(args, { cwd, env }) {
  return execFileSync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8" });
}

function makeVariant(env, name, doc) {
  fs.mkdirSync(path.join(env.OV_HOME, "variants"), { recursive: true });
  fs.writeFileSync(path.join(env.OV_HOME, "variants", `${name}.json`), JSON.stringify(doc));
}

test("init/status/use/models-set slot fan-out end to end", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "work", {
    tier: "hybrid",
    description: "cloud plan, slot executor",
    roles: { plan: { model: "prov/cloud" }, executor: { slot: "model-fast" } },
  });
  run(["models", "set", "model-fast", "prov/fast"], { cwd: proj, env });

  const out = run(["init", "--variant", "work"], { cwd: proj, env });
  assert.match(out, /→ work/);
  const envrc = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc, /# managed-by: opencode-variants work @[0-9a-f]{64}/);
  assert.match(envrc, /"model": "prov\/cloud"/);
  assert.match(envrc, /"model": "prov\/fast"/);
  assert.doesNotMatch(envrc, /disabled_providers|"provider":/);

  const status = run(["status"], { cwd: proj, env });
  assert.match(status, new RegExp(proj));
  assert.match(status, /\bok\b/);

  assert.match(run(["use"], { cwd: proj, env }), /work \(hybrid\) — .*used by: /);

  run(["models", "set", "model-fast", "prov/faster"], { cwd: proj, env });
  assert.match(fs.readFileSync(path.join(proj, ".envrc"), "utf8"), /"model": "prov\/faster"/);
});

test("restriction fields appear in generated content", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "r", {
    tier: "cloud", description: "d",
    roles: { plan: { model: "prov/x" } },
    denyProviders: ["gone"],
    limits: { prov: { allow: ["x"] } },
  });
  run(["init", "--variant", "r"], { cwd: proj, env });
  const envrc = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc, /"disabled_providers": \[\s*"gone"/);
  assert.match(envrc, /"whitelist": \[\s*"x"/);
});

test("unset slot fails with an actionable message", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "s", { tier: "cloud", description: "", roles: { plan: { slot: "model-reasoning" } } });
  try {
    run(["init", "--variant", "s"], { cwd: proj, env });
    assert.fail("expected exit 1");
  } catch (e) {
    assert.match(String(e.stderr), /slot model-reasoning is not set \(models set model-reasoning/);
  }
});

test("use without variants prints a hint instead of nothing", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  assert.match(run(["use"], { cwd: proj, env }), /no variants yet/);
});

test("models shows unset slots", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  const out = run(["models"], { cwd: proj, env });
  assert.match(out, /model-reasoning = \(unset\)/);
  assert.match(out, /model-fast = \(unset\)/);
});

test("use refuses to overwrite a hand-edited .envrc without --force", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "v", { tier: "cloud", description: "", roles: { plan: { model: "prov/x" } } });
  makeVariant(env, "w", { tier: "cloud", description: "", roles: { plan: { model: "prov/y" } } });
  run(["init", "--variant", "v"], { cwd: proj, env });
  fs.writeFileSync(path.join(proj, ".envrc"), "manual\n");
  try {
    run(["use", "w"], { cwd: proj, env });
    assert.fail("expected exit 1");
  } catch (e) {
    assert.match(String(e.stderr), /refusing to overwrite hand-edited/);
  }
});

test("init accepts --variant=<name> equals form", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "v", { tier: "cloud", description: "", roles: { plan: { model: "prov/x" } } });
  run(["init", "--variant=v"], { cwd: proj, env });
  assert.ok(fs.existsSync(path.join(proj, ".envrc")));
});

test("init without --variant fails non-interactively", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  try {
    run(["init"], { cwd: proj, env });
    assert.fail("expected exit 1");
  } catch (e) {
    assert.match(String(e.stderr), /non-interactive/);
  }
});

test("use listing survives corrupt variant files", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  fs.mkdirSync(path.join(env.OV_HOME, "variants"), { recursive: true });
  fs.writeFileSync(path.join(env.OV_HOME, "variants", "broken.json"), "{oops");
  assert.match(run(["use"], { cwd: proj, env }), /broken \(broken/);
});

test("models set only regenerates dirs whose variants reference the slot", () => {
  const env = makeEnv();
  const a = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-projA-")));
  const b = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-projB-")));
  makeVariant(env, "fa", { tier: "cloud", description: "", roles: { executor: { slot: "model-fast" } } });
  makeVariant(env, "ra", { tier: "cloud", description: "", roles: { plan: { slot: "model-reasoning" } } });
  run(["models", "set", "model-fast", "prov/f"], { cwd: a, env });
  run(["models", "set", "model-reasoning", "prov/r"], { cwd: a, env });
  run(["init", "--variant", "fa"], { cwd: a, env });
  run(["init", "--variant", "ra"], { cwd: b, env });
  run(["models", "set", "model-fast", "prov/f2"], { cwd: a, env });
  assert.match(fs.readFileSync(path.join(a, ".envrc"), "utf8"), /"model": "prov\/f2"/);
  assert.match(fs.readFileSync(path.join(b, ".envrc"), "utf8"), /"model": "prov\/r"/);
});

test("models set exits 1 after skipping drifted dirs", () => {
  const env = makeEnv();
  const a = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-projA-")));
  const b = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-projB-")));
  makeVariant(env, "v", { tier: "cloud", description: "", roles: { plan: { slot: "model-fast" } } });
  run(["models", "set", "model-fast", "prov/1"], { cwd: a, env });
  run(["init", "--variant", "v"], { cwd: a, env });
  run(["init", "--variant", "v"], { cwd: b, env });
  fs.writeFileSync(path.join(b, ".envrc"), "manual\n");
  try {
    run(["models", "set", "model-fast", "prov/2"], { cwd: a, env });
    assert.fail("expected exit 1");
  } catch (e) {
    assert.match(String(e.stderr), new RegExp(`skipped ${b}`));
  }
  assert.match(fs.readFileSync(path.join(a, ".envrc"), "utf8"), /"model": "prov\/2"/);
});

test("status reports drifted and variant missing", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "v", { tier: "cloud", description: "", roles: { plan: { model: "prov/x" } } });
  run(["init", "--variant", "v"], { cwd: proj, env });
  fs.appendFileSync(path.join(proj, ".envrc"), "# hand note\n");
  assert.match(run(["status"], { cwd: proj, env }), /\bdrifted\b/);
  fs.rmSync(path.join(env.OV_HOME, "variants", "v.json"));
  assert.match(run(["status"], { cwd: proj, env }), /\bvariant missing\b/);
});

test("init works when slots pre-set and shows values in models listing", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "s", { tier: "cloud", description: "", roles: { plan: { slot: "model-fast" } } });
  run(["models", "set", "model-fast", "prov/x"], { cwd: proj, env });
  assert.match(run(["models"], { cwd: proj, env }), /model-fast = prov\/x/);
  run(["init", "--variant", "s"], { cwd: proj, env });
  assert.match(fs.readFileSync(path.join(proj, ".envrc"), "utf8"), /"model": "prov\/x"/);
});

test("models set rejects unknown and prototype-chain slot names", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  for (const name of ["bogus", "constructor", "toString"]) {
    try {
      run(["models", "set", name, "prov/x"], { cwd: proj, env });
      assert.fail(`expected exit 1 for ${name}`);
    } catch (e) {
      assert.match(String(e.stderr), /unknown slot/);
    }
  }
});

test("no arguments and help both print usage", () => {
  const env = makeEnv();
  for (const args of [[], ["help"]]) {
    const out = run(args, { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "amc-h-")), env });
    assert.match(out, /Usage: ov/);
    assert.match(out, /init/);
    assert.match(out, /models set/);
    assert.match(out, /status/);
  }
});

test("restrict requires a variant argument or a managed directory", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  try {
    run(["restrict"], { cwd: proj, env });
    assert.fail("expected exit 1");
  } catch (e) {
    assert.match(String(e.stderr), /no variant given and this directory is not managed/);
  }
  try {
    run(["restrict", "nope"], { cwd: proj, env });
    assert.fail("expected exit 1");
  } catch (e) {
    assert.match(String(e.stderr), /unknown variant: nope/);
  }
});

test("show pretty-prints roles, slot resolution, effort, restrictions", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "rep", {
    tier: "hybrid",
    description: "report test",
    roles: {
      plan: { model: "prov/cloud", variant: "high" },
      executor: { slot: "model-fast" },
      scout: { slot: "model-reasoning" },
    },
    denyProviders: ["beta"],
    limits: { prov: { allow: ["cloud"] } },
  });
  run(["models", "set", "model-fast", "prov/fast"], { cwd: proj, env });
  const out = run(["show", "rep"], { cwd: proj, env });
  assert.match(out, /◆ rep \(hybrid\) — report test/);
  assert.match(out, /plan\s+->\s+prov\/cloud\s+\* high/);
  assert.match(out, /executor\s+->\s+prov\/fast \(via model-fast\)/);
  assert.match(out, /scout\s+->\s+\(slot model-reasoning unset\)/);
  assert.match(out, /disabled providers: beta/);
  assert.match(out, /prov only: cloud/);
});

test("show without a variant in an unmanaged dir fails", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  try {
    run(["show"], { cwd: proj, env });
    assert.fail("should have failed");
  } catch (err) {
    assert.match(String(err.stderr ?? err), /no variant given/);
  }
});

test("status is scoped to the current tree; --all lists everything", () => {
  const env = makeEnv();
  const projA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-projA-")));
  const projB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-projB-")));
  makeVariant(env, "v", { tier: "cloud", description: "", roles: { plan: { model: "prov/x" } } });
  run(["init", "--variant", "v"], { cwd: projA, env });
  const scoped = run(["status"], { cwd: projB, env });
  assert.match(scoped, /no environment in effect from here up/);
  const all = run(["status", "--all"], { cwd: projB, env });
  assert.ok(all.includes(projA));
  const inA = run(["status"], { cwd: projA, env });
  assert.ok(inA.includes(projA) && !inA.includes(projB));
});

test("scoped variant in a tree shadows the global one of the same name", () => {
  const env = makeEnv();
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const proj = path.join(tree, "work", "proj");
  fs.mkdirSync(proj, { recursive: true });
  makeVariant(env, "hybrid", { tier: "cloud", description: "global hybrid", roles: { plan: { model: "prov/global" } } });
  fs.mkdirSync(path.join(tree, ".opencode-variants", "variants"), { recursive: true });
  fs.writeFileSync(path.join(tree, ".opencode-variants", "variants", "hybrid.json"), JSON.stringify({
    tier: "hybrid", description: "work hybrid", roles: { plan: { model: "copilot/premium" } },
  }));

  const out = run(["init", "--variant", "hybrid"], { cwd: proj, env });
  assert.match(out, /→ hybrid/);
  const envrc = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc, /copilot\/premium/);
  assert.doesNotMatch(envrc, /prov\/global/);

  const listing = run(["variants"], { cwd: proj, env });
  assert.match(listing, /work hybrid/);
  assert.match(listing, new RegExp(`scoped: ${tree}`));
});

test("unmanage removes generated .envrc, selector, and registry entry", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "work", { tier: "cloud", roles: { plan: { model: "prov/cloud" } } });
  run(["init", "--variant", "work"], { cwd: proj, env });

  const out = run(["unmanage"], { cwd: proj, env });
  assert.match(out, /removed \.envrc, selector removed, registry entry removed/);
  assert.equal(fs.existsSync(path.join(proj, ".envrc")), false);
  assert.equal(fs.existsSync(path.join(proj, ".opencode-variants.json")), false);
  assert.match(run(["status"], { cwd: proj, env }), /no environment in effect from here up/);

  assert.equal(fs.existsSync(path.join(proj, ".envrc")), false);
});

test("unmanage keeps drifted or unmanaged .envrc files", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "work", { tier: "cloud", roles: { plan: { model: "prov/cloud" } } });
  run(["init", "--variant", "work"], { cwd: proj, env });
  fs.appendFileSync(path.join(proj, ".envrc"), "export MINE=1\n");

  const out = run(["unmanage"], { cwd: proj, env });
  assert.match(out, /kept drifted \.envrc/);
  assert.match(fs.readFileSync(path.join(proj, ".envrc"), "utf8"), /MINE=1/);
});

test("prune drops gone dirs; missing-variant dirs need --force (which unmanages them)", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "work", { tier: "cloud", roles: { plan: { model: "prov/cloud" } } });
  run(["init", "--variant", "work"], { cwd: proj, env });
  const dirsFile = path.join(env.OV_HOME, "dirs.json");
  const gone = path.join(os.tmpdir(), `amc-gone-${Date.now()}`);
  fs.writeFileSync(dirsFile, JSON.stringify([...JSON.parse(fs.readFileSync(dirsFile, "utf8")), gone]));

  const out = run(["prune"], { cwd: proj, env });
  assert.match(out, new RegExp(`pruned ${gone} \\(directory gone\\)`));
  assert.match(run(["status"], { cwd: proj, env }), /work\b.*\bok\b/s);

  fs.rmSync(path.join(env.OV_HOME, "variants", "work.json"));
  const skip = run(["prune"], { cwd: proj, env });
  assert.match(skip, /skipped 1 directory with a missing variant/);
  assert.match(fs.readFileSync(dirsFile, "utf8"), new RegExp(proj));

  const forced = run(["prune", "--force"], { cwd: proj, env });
  assert.match(forced, /variant work missing — unmanaged/);
  assert.deepEqual(JSON.parse(fs.readFileSync(dirsFile, "utf8")), []);
  assert.equal(fs.existsSync(path.join(proj, ".envrc")), false);
});

test("rm refuses while dirs reference the variant; --force deletes; scoped rm picks the shadow", () => {
  const env = makeEnv();
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  makeVariant(env, "work", { tier: "cloud", roles: { plan: { model: "prov/cloud" } } });
  run(["init", "--variant", "work"], { cwd: proj, env });

  assert.throws(
    () => run(["rm", "work"], { cwd: proj, env }),
    (e) => /is used by/.test(e.stderr) && /prune --force/.test(e.stderr) === false,
  );
  const forced = run(["rm", "--force", "work"], { cwd: proj, env });
  assert.match(forced, /removed variant work/);
  assert.match(forced, /still reference it; run: prune --force/);
  assert.equal(fs.existsSync(path.join(env.OV_HOME, "variants", "work.json")), false);

  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  makeVariant(env, "hybrid", { tier: "cloud", roles: { plan: { model: "prov/global" } } });
  fs.mkdirSync(path.join(tree, ".opencode-variants", "variants"), { recursive: true });
  fs.writeFileSync(path.join(tree, ".opencode-variants", "variants", "hybrid.json"), JSON.stringify({
    tier: "hybrid", roles: { plan: { model: "copilot/premium" } },
  }));
  const out = run(["rm", "hybrid"], { cwd: tree, env });
  assert.match(out, new RegExp(`removed variant hybrid.*\\.opencode-variants`));
  assert.equal(fs.existsSync(path.join(tree, ".opencode-variants", "variants", "hybrid.json")), false);
  assert.equal(fs.existsSync(path.join(env.OV_HOME, "variants", "hybrid.json")), true);
});

test("nearest parent .envrc is the baseline: patch forks it into the child", () => {
  const env = makeEnv();
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const proj = path.join(tree, "deep", "proj");
  fs.mkdirSync(proj, { recursive: true });
  makeVariant(env, "local", { tier: "local", description: "on-box", roles: { plan: { model: "loc/a" }, build: { model: "loc/b" } } });
  run(["init", "--variant", "local"], { cwd: tree, env });

  const out = run(["patch", "plan", "cloud/x"], { cwd: proj, env });
  assert.match(out, /→ local-plan/);
  const envrc = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc, /"model": "cloud\/x"/);
  assert.match(envrc, /"model": "loc\/b"/);
  // fork of a global variant is saved beside it (global store), not in the child
  assert.match(fs.readFileSync(path.join(env.OV_HOME, "variants", "local-plan.json"), "utf8"), /forked from local/);
  assert.equal(fs.existsSync(path.join(proj, ".opencode-variants", "variants", "local-plan.json")), false);
  const scoped = run(["variants"], { cwd: proj, env });
  assert.match(scoped, /local-plan/);

  // second patch updates the dir's own variant in place (no fork chain)
  run(["patch", "plan", "cloud/y"], { cwd: proj, env });
  const envrc2 = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc2, /"model": "cloud\/y"/);
  assert.doesNotMatch(envrc2, /cloud\/x/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proj, ".opencode-variants.json"), "utf8")), { variant: "local-plan" });
  run(["patch", "build", "cloud/z"], { cwd: proj, env });
  const envrc3 = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc3, /cloud\/y/);
  assert.match(envrc3, /cloud\/z/);

  // forking from a parent collides with an existing variant name
  const proj2 = path.join(tree, "deep", "proj2");
  fs.mkdirSync(proj2, { recursive: true });
  makeVariant(env, "local-plan", { tier: "cloud", roles: { plan: { model: "g/x" } } });
  assert.throws(() => run(["patch", "plan", "cloud/y"], { cwd: proj2, env }), (e) => /local-plan already exists/.test(e.stderr));
  assert.throws(() => run(["patch", "bogus", "cloud/y"], { cwd: proj2, env }), (e) => /unknown role/.test(e.stderr));
});

test("patch fork of a tree-scoped parent is saved in the tree store", () => {
  const env = makeEnv();
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const app = path.join(tree, "app");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(path.join(tree, ".opencode-variants", "variants"), { recursive: true });
  fs.writeFileSync(path.join(tree, ".opencode-variants", "variants", "twork.json"), JSON.stringify({
    tier: "hybrid", description: "tree base", roles: { plan: { model: "tw/a" }, build: { model: "tw/b" } },
  }));
  run(["init", "--variant", "twork"], { cwd: tree, env });

  run(["patch", "plan", "cloud/t"], { cwd: app, env });
  assert.match(fs.readFileSync(path.join(tree, ".opencode-variants", "variants", "twork-plan.json"), "utf8"), /forked from twork/);
  assert.equal(fs.existsSync(path.join(app, ".opencode-variants", "variants", "twork-plan.json")), false);
  assert.match(fs.readFileSync(path.join(app, ".envrc"), "utf8"), /cloud\/t/);
});

test("show and restrict default to the nearest parent's variant", () => {
  const env = makeEnv();
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const proj = path.join(tree, "sub");
  fs.mkdirSync(proj, { recursive: true });
  makeVariant(env, "local", { tier: "local", description: "on-box", roles: { plan: { model: "loc/a" } } });
  run(["init", "--variant", "local"], { cwd: tree, env });

  const out = run(["show"], { cwd: proj, env });
  assert.match(out, /◆ local/);
  assert.match(out, /plan\s+->\s+loc\/a/);

  // target resolves from the parent (failure is the TTY requirement, not "no variant")
  assert.throws(
    () => run(["restrict"], { cwd: proj, env }),
    (e) => /requires a TTY/.test(e.stderr),
  );
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-far-")));
  assert.throws(
    () => run(["restrict"], { cwd: elsewhere, env }),
    (e) => /no variant given/.test(e.stderr),
  );
});

test("status lists every variant visible from here; use from a child binds the tree's variant", () => {
  const env = makeEnv();
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-tree-")));
  const child = path.join(tree, "proj");
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(path.join(tree, ".opencode-variants", "variants"), { recursive: true });
  fs.writeFileSync(path.join(tree, ".opencode-variants", "variants", "t1.json"), JSON.stringify({
    tier: "hybrid", description: "tree base", roles: { plan: { model: "tw/base" } },
  }));
  makeVariant(env, "t1", { tier: "cloud", description: "global twin", roles: { plan: { model: "g/base" } } });
  makeVariant(env, "g1", { tier: "local", description: "global only", roles: { plan: { model: "g/only" } } });
  run(["init", "--variant", "t1"], { cwd: tree, env });

  const st = run(["status"], { cwd: child, env });
  assert.match(st, /variants here/);
  assert.match(st, new RegExp(`t1\\s+\\[scoped: ${tree}\\] \\(in use, shadows global\\)`));
  assert.match(st, /g1\s+\[global: /);

  run(["use", "g1"], { cwd: child, env });
  assert.match(fs.readFileSync(path.join(child, ".envrc"), "utf8"), /g\/only/);
  const st2 = run(["status"], { cwd: child, env });
  assert.match(st2, /g1\s+\[global: .*\(in use\)/);

  // default status excludes child environments; --all adds them
  const st3 = run(["status"], { cwd: tree, env });
  assert.doesNotMatch(st3, new RegExp(child));
  assert.doesNotMatch(st3, /g1\s+\[global: .*\(in use\)/);
  assert.match(run(["status", "--all"], { cwd: tree, env }), new RegExp(child));
});

test("migration: legacy ai-model-configure state, selectors, stores, and markers are carried over", () => {
  const legacyState = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-legacy-")));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-")));
  fs.mkdirSync(path.join(legacyState, "variants"), { recursive: true });
  fs.writeFileSync(path.join(legacyState, "variants", "old.json"), JSON.stringify({
    tier: "cloud", roles: { plan: { model: "prov/x" } },
  }));
  fs.mkdirSync(path.join(proj, ".ai-model-configure", "variants"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".ai-model-configure", "variants", "tree.json"), JSON.stringify({
    tier: "hybrid", roles: { plan: { model: "tw/y" } },
  }));
  fs.writeFileSync(path.join(proj, ".ai-model-configure.json"), JSON.stringify({ variant: "tree" }));
  const body = "export OPENCODE_CONFIG_CONTENT='{}'\n";
  const h = crypto.createHash("sha256").update(body).digest("hex");
  fs.writeFileSync(path.join(proj, ".envrc"), `# managed-by: ai-model-configure tree @${h}\n${body}`);
  fs.writeFileSync(path.join(legacyState, "dirs.json"), JSON.stringify([proj]));

  const env = makeEnv();
  env.AMC_HOME = legacyState;

  const out = run(["variants"], { cwd: proj, env });
  assert.match(out, /tree \(hybrid\)/);
  assert.ok(fs.existsSync(path.join(env.OV_HOME, "variants", "old.json")));
  assert.ok(fs.existsSync(path.join(proj, ".opencode-variants.json")));
  assert.ok(fs.existsSync(path.join(proj, ".opencode-variants", "variants", "tree.json")));
  const envrc = fs.readFileSync(path.join(proj, ".envrc"), "utf8");
  assert.match(envrc, /# managed-by: opencode-variants/);

  const status = run(["status"], { cwd: proj, env });
  assert.match(status, /tree\b.*\bok\b/s);
});
