import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BIN = new URL("../bin/ai", import.meta.url).pathname;

function makeEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amc-ai-home-"));
  const stub = path.join(home, "stub");
  fs.writeFileSync(stub, "#!/bin/sh\nprintf 'ARGS:%s\\n' \"$*\"\nprintf 'CONTENT:%s' \"$OPENCODE_CONFIG_CONTENT\"\n");
  fs.chmodSync(stub, 0o755);
  const amc = path.join(home, "state");
  fs.mkdirSync(path.join(amc, "variants"), { recursive: true });
  fs.writeFileSync(path.join(amc, "variants", "work.json"), JSON.stringify({
    tier: "hybrid",
    description: "",
    roles: { plan: { model: "prov/cloud", variant: "high" }, executor: { slot: "model-fast" } },
    denyProviders: ["beta"],
  }));
  fs.writeFileSync(path.join(amc, "slots.json"), JSON.stringify({ "model-reasoning": null, "model-fast": "prov/fast" }));
  return { HOME: home, AMC_HOME: amc, AMC_OPENCODE_BIN: stub, AMC_DIRENV: "/usr/bin/true", PATH: process.env.PATH };
}

test("ai <variant> injects resolved config and forwards args", () => {
  const env = makeEnv();
  const out = execFileSync(process.execPath, [BIN, "work", "serve", "--port", "1"], { env, cwd: env.HOME, encoding: "utf8" });
  assert.match(out, /ARGS:serve --port 1/);
  assert.match(out, /isn't used in/);
  const json = JSON.parse(out.slice(out.indexOf("CONTENT:") + 8));
  assert.deepEqual(json.agent, {
    plan: { model: "prov/cloud", variant: "high" },
    executor: { model: "prov/fast" },
  });
  assert.deepEqual(json.disabled_providers, ["beta"]);
});

test("ai <variant> fails loudly on unset slot", () => {
  const env = makeEnv();
  fs.writeFileSync(path.join(env.AMC_HOME, "slots.json"), JSON.stringify({ "model-reasoning": null, "model-fast": null }));
  try {
    execFileSync(process.execPath, [BIN, "work"], { env, cwd: env.HOME, encoding: "utf8", stderr: "pipe" });
    assert.fail("should have failed");
  } catch (err) {
    assert.match(String(err.stderr), /slot model-fast is not set/);
  }
});

test("ai help lists variants; unknown variant errors", () => {
  const env = makeEnv();
  assert.match(execFileSync(process.execPath, [BIN, "help"], { env, cwd: env.HOME, encoding: "utf8" }), /other:\s+work/);
  try {
    execFileSync(process.execPath, [BIN, "nope"], { env, cwd: env.HOME, encoding: "utf8", stderr: "pipe" });
    assert.fail("should have failed");
  } catch (err) {
    assert.match(String(err.stderr), /unknown variant: nope \(known: work\)/);
  }
});
