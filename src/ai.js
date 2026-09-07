import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { loadVariant, variantNames } from "./variants.js";
import { loadSlots } from "./slots.js";
import { generateConfig } from "./generate.js";
import { loadDirs, selectorOf } from "./envrc.js";

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s);

export function runAi(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const [name, ...opencodeArgs] = argv;
  const names = variantNames(env, cwd);
  const here = fs.realpathSync(cwd);
  const usedIn = (variant) => loadDirs(env)
    .filter((d) => selectorOf(d)?.variant === variant)
    .map((d) => fs.realpathSync(d))
    .filter((d) => d === here || d.startsWith(`${here}/`) || here.startsWith(`${d}/`));
  const usedAnywhere = (variant) => loadDirs(env)
    .filter((d) => selectorOf(d)?.variant === variant)
    .map((d) => fs.realpathSync(d));

  if (!name || name === "-h" || name === "--help" || name === "help") {
    const lines = [`usage: ai <variant> [opencode args…]`, ``, `Launches opencode with the variant's routing config injected (a config`, `container: no direnv or per-directory .envrc needed for the launch).`];
    if (names.length) {
      const local = names.filter((n) => usedIn(n).length);
      const other = names.filter((n) => !usedIn(n).length);
      lines.push("", `in this tree:  ${local.join(", ") || dim("(none)")}`);
      if (other.length) lines.push(`other:         ${other.join(", ")}`);
    } else {
      lines.push("", "no variants — run: ai-model-configure init");
    }
    console.log(lines.join("\n"));
    process.exit(name ? 0 : 1);
  }
  const v = loadVariant(name, env, cwd);
  if (!v) {
    console.error(`error: unknown variant: ${name}${names.length ? ` (known: ${names.join(", ")})` : ""}`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = generateConfig(v, loadSlots(env));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  const bin = env.AMC_OPENCODE_BIN || "opencode";
  console.log(`${dim(`launching ${bin} with variant`)} ${name} ${dim(`(${v.tier ?? "?"})${opencodeArgs.length ? ` · opencode args: ${opencodeArgs.join(" ")}` : ""}`)}`);
  if (!usedIn(name).length) {
    const where = usedAnywhere(name);
    console.log(dim(`  note: this variant isn't used in ${cwd}${where.length ? ` — it's applied in ${where.join(", ")}` : " and nowhere yet"}`));
  }
  const r = spawnSync(bin, opencodeArgs, {
    stdio: "inherit",
    cwd,
    env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(cfg, null, 2) },
  });
  if (r.error) {
    console.error(`error: ${r.error.code === "ENOENT" ? `${bin} not found on PATH (or set AMC_OPENCODE_BIN)` : r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}
