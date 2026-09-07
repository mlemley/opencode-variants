import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadSlots, saveSlots } from "./slots.js";
import { variantNames, loadVariant, saveVariant, resolveVariant, variantFilePath, nearestStoreDir, variantsDir } from "./variants.js";
import { discoverCatalog, refreshCatalog } from "./catalog.js";
import { resolveRoles } from "./roles.js";
import { generateConfig, renderEnvrc, markerHash, contentHash } from "./generate.js";
import { writeEnvrc, loadDirs, writeDirs, selectorOf, unmanageDir, nearestSelector } from "./envrc.js";
import { runWizard, editRestrictions } from "./wizard.js";

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const hi = (s) => c("1;36", s);
const eff = (s) => c("35", s);

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function applyPicks(picks, env) {
  if (!Object.keys(picks).length) return;
  const slots = loadSlots(env);
  let changed = false;
  for (const [slot, ref] of Object.entries(picks)) {
    if (Object.hasOwn(slots, slot) && slots[slot] !== ref) {
      slots[slot] = ref;
      changed = true;
    }
  }
  if (changed) saveSlots(slots, env);
}

function printHelp() {
  console.log(`ai-model-configure — per-directory OpenCode model routing

Usage: ai-model-configure <command>

  init [--variant <name>]  establish a NEW environment: wizard creates a
                           variant and it is paired with this directory
                           (.envrc + .ai-model-configure/variants here;
                           --global stores the definition globally) —
                           or just apply an existing variant here
  add                      wizard: contribute a new variant to the tree's
                           variant store (nearest store walking up, else
                           global) without applying it anywhere
  use <variant>            apply a variant to this directory
  use | variants           list variants (with the directories using them)
  models                   show slot values (model-reasoning, model-fast)
  models set <slot> <ref>  set a slot; regenerates managed dirs using it
  models refresh           re-pull the model catalog from models.dev
  status                   the environment chain in effect HERE: this
                           directory and its parent environments with
                           drift state (ok | drifted | missing .envrc |
                           variant missing), plus every variant visible
                           from here (global / parent / current scope,
                           nearest wins); --all adds child environments
  show | log <variant>    pretty-print a variant: role -> model * effort
                          (defaults to this directory's variant)
  edit [variant]           re-run the wizard (name/description/roles prefilled
                           from the variant — defaults to the one loaded
                           here, i.e. the nearest parent's) and regenerate
                           every directory on the edited variant
  fork [variant]           copy the loaded (or named) variant into a NEW
                           variant saved beside the original (same store,
                           visible across that tree) and apply it here
  patch <role> <model>     quick change of one role on the variant loaded
                           here: updates this directory's own variant in
                           place, or forks the parent's as <variant>-<role>
                           saved beside it and applied here
  restrict [variant]       change only provider/model restrictions of a
                           variant (defaults to this directory's variant)
  rm <variant>             delete a variant file (refuses while
                           directories reference it, unless --force)
  unmanage [dir…]          detach a directory: remove its generated
                           .envrc, selector, and registry entry
                           (drifted/hand-written .envrc files are kept)
  prune [--force]          drop registry entries for gone/broken
                           directories; --force also unmanages
                           directories whose variant no longer exists
  help                     this help

Also installed: ai <variant> [opencode args…] — launch opencode with a
variant's config injected, and ai-cost [provider] — model prices.

State lives in ~/.config/ai-model-configure/ (variants/, slots.json,
dirs.json). Variants are also allowed per tree: the nearest
<dir>/.ai-model-configure/variants/<name>.json walking up from you
shadows the global store, so ~/work can carry its own "hybrid".
Generated files are marked '# managed-by: ai-model-configure'.`);
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const force = argv.includes("--force");
  const global = argv.includes("--global");
  const args = argv.filter((a) => a !== "--force" && a !== "--global");
  const [cmd, ...rest] = args;

  function applyVariant(dir, name) {
    const v = loadVariant(name, env, dir);
    if (!v) fail(`unknown variant: ${name}`);
    const cfg = generateConfig(v, loadSlots(env));
    writeEnvrc(dir, renderEnvrc(cfg, { variantName: name, cwd: dir }), { variantName: name, force, env });
    console.log(`${dir} → ${name}`);
  }

  if (cmd === "init") {
    const eq = rest.find((a) => a.startsWith("--variant="));
    const vIdx = rest.indexOf("--variant");
    let name;
    if (eq || vIdx >= 0) {
      name = eq ? eq.slice("--variant=".length) : rest[vIdx + 1];
      if (!name || name.startsWith("--") || !loadVariant(name, env, cwd)) fail(`unknown variant: ${name}`);
    } else {
      if (!process.stdin.isTTY) fail("non-interactive: init --variant <name>");
      const { variant: built, picks } = await runWizard({
        roles: resolveRoles({ cwd, env }),
        catalog: await discoverCatalog({ env }), slots: loadSlots(env),
      });
      applyPicks(picks, env);
      // init pairs the environment with its own definition: .envrc and
      // .ai-model-configure/variants/<name>.json both land here.
      if (!global && resolveVariant(built.name, env, cwd)?.scope === cwd) {
        console.log(dim(`replacing existing ${built.name} in ${cwd}`));
      } else if (!global && variantFilePath(built.name, env, cwd)) {
        console.log(dim(`note: ${built.name} also exists higher up — this copy shadows it from ${cwd} down (to change the upper one: edit ${built.name})`));
      }
      saveVariant(built, env, global ? null : cwd);
      name = built.name;
    }
    applyVariant(cwd, name);
    return;
  }

  if (cmd === "add") {
    if (!process.stdin.isTTY) fail("non-interactive: add requires a TTY (to apply an existing variant: use <name>)");
    const store = global ? null : nearestStoreDir(cwd);
    const { variant: built, picks } = await runWizard({
      roles: resolveRoles({ cwd, env }),
      catalog: await discoverCatalog({ env }), slots: loadSlots(env),
    });
    applyPicks(picks, env);
    saveVariant(built, env, store);
    console.log(`added ${built.name} to ${store ?? "the global store"}`);
    console.log(dim(`nothing applied yet — bind a directory with: use ${built.name}`));
    return;
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h" || !cmd) {
    printHelp();
    return;
  }

  if (cmd === "use" || cmd === "variants") {
    if (cmd === "use" && rest[0]) {
      applyVariant(cwd, rest[0]);
      return;
    }
    const names = variantNames(env, cwd);
    if (!names.length) {
      console.log("no variants yet — run: ai-model-configure init");
      return;
    }
    const dirs = loadDirs(env);
    for (const n of names) {
      const resolved = resolveVariant(n, env, cwd);
      const v = resolved?.variant;
      if (!v) {
        console.log(`${n} (broken — invalid JSON, fix or delete)`);
        continue;
      }
      const users = dirs.filter((d) => selectorOf(d)?.variant === n);
      const scope = resolved.scope ? dim(`  [scoped: ${resolved.scope}]`) : "";
      console.log(`${n} (${v.tier ?? "?"}) — ${v.description ?? ""}${users.length ? `  [used by: ${users.join(", ")}]` : ""}${scope}`);
    }
    return;
  }

  if (cmd === "show" || cmd === "log" || cmd === "inspect" || cmd === "info") {
    const name = rest[0] ?? nearestSelector(cwd)?.variant;
    if (!name) fail("no variant given and this directory isn't managed — usage: show <variant>");
    const resolved = resolveVariant(name, env, cwd);
    const v = resolved?.variant;
    if (!v) fail(`unknown variant: ${name}`);
    const slots = loadSlots(env);
    console.log(`${hi(bold(`◆ ${v.name}`))} ${dim(`(${v.tier ?? "?"}) — ${v.description || "no description"}${resolved.scope ? ` · scoped: ${resolved.scope}` : ""}`)}`);
    const users = loadDirs(env).filter((d) => selectorOf(d)?.variant === v.name);
    if (users.length) console.log(dim(`  applied in: ${users.join(", ")}`));
    console.log("");
    const items = Object.entries(v.roles).map(([role, r]) => ({
      role,
      plain: r.slot
        ? (slots[r.slot] ? `${slots[r.slot]} (via ${r.slot})` : `(slot ${r.slot} unset)`)
        : r.model,
      variant: r.variant,
    }));
    const rw = Math.max(...items.map((i) => i.role.length));
    const tw = Math.max(...items.map((i) => i.plain.length));
    for (const it of items) {
      const target = /\(slot .* unset\)$/.test(it.plain) ? c("31", it.plain.padEnd(tw)) : it.plain.padEnd(tw);
      console.log(`  ${it.role.padEnd(rw)}  ->  ${target}${it.variant ? ` ${eff(`* ${it.variant}`)}` : ""}`);
    }
    const limitLines = Object.entries(v.limits || {}).flatMap(([p, l]) => [
      ...(l.allow ? [`    ${p} only: ${l.allow.join(", ")}`] : []),
      ...(l.deny ? [`    ${p} except: ${l.deny.join(", ")}`] : []),
    ]);
    if (v.denyProviders?.length || limitLines.length) {
      console.log(`\n  ${dim("restrictions:")}`);
      if (v.denyProviders?.length) console.log(dim(`    disabled providers: ${v.denyProviders.join(", ")}`));
      for (const l of limitLines) console.log(dim(l));
    }
    return;
  }

  if (cmd === "edit") {
    if (!process.stdin.isTTY) fail("non-interactive: edit requires a TTY");
    let prefill = {};
    let saveScope = null;
    if (rest[0]) {
      const resolved = resolveVariant(rest[0], env, cwd);
      if (!resolved) fail(`unknown variant: ${rest[0]}`);
      const v = resolved.variant;
      saveScope = global ? null : resolved.scope ?? cwd;
      prefill = {
        name: v.name,
        description: v.description,
        roles: v.roles,
        denyProviders: v.denyProviders,
        limits: v.limits,
      };
    } else {
      const src = nearestSelector(cwd);
      const r = src && resolveVariant(src.variant, env, src.dir);
      if (r) {
        if (src.dir !== cwd) console.log(dim(`seeding from ${src.variant} (${src.dir}) — edits save in place`));
        prefill = {
          name: r.variant.name,
          description: r.variant.description,
          roles: r.variant.roles,
          denyProviders: r.variant.denyProviders,
          limits: r.variant.limits,
        };
        saveScope = global ? null : r.scope ?? cwd;
      } else {
        saveScope = global ? null : cwd;
      }
    }
    const { variant: built, picks } = await runWizard({
      roles: resolveRoles({ cwd, env }),
      catalog: await discoverCatalog({ env }),
      slots: loadSlots(env),
      prefill,
    });
    applyPicks(picks, env);
    saveVariant(built, env, saveScope);
    let n = 0;
    const failed = [];
    for (const d of loadDirs(env)) {
      if (selectorOf(d)?.variant === built.name) {
        try {
          applyVariant(d, built.name);
          n++;
        } catch (err) {
          failed.push(`${d}: ${err.message}`);
        }
      }
    }
    console.log(`updated ${built.name}; regenerated ${n} director${n === 1 ? "y" : "ies"}`);
    if (failed.length) {
      for (const f of failed) console.error(`skipped ${f}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "restrict" || cmd === "restrictions") {
    const target = rest[0] || nearestSelector(cwd)?.variant;
    if (!target) fail("no variant given and this directory is not managed");
    const resolved = resolveVariant(target, env, cwd);
    const existing = resolved?.variant;
    if (!existing) fail(`unknown variant: ${target}`);
    if (!process.stdin.isTTY) fail("non-interactive: restrict requires a TTY");
    const catalog = await discoverCatalog({ env });
    const { denyProviders, limits } = await editRestrictions({ catalog, variant: existing });
    saveVariant({
      ...existing,
      denyProviders: denyProviders.length ? denyProviders : undefined,
      limits: Object.keys(limits).length ? limits : undefined,
    }, env, resolved.scope);
    let rn = 0;
    const rfailed = [];
    for (const d of loadDirs(env)) {
      if (selectorOf(d)?.variant === target) {
        try {
          applyVariant(d, target);
          rn++;
        } catch (err) {
          rfailed.push(`${d}: ${err.message}`);
        }
      }
    }
    console.log(`updated restrictions on ${target}; regenerated ${rn} director${rn === 1 ? "y" : "ies"}`);
    if (rfailed.length) {
      for (const f of rfailed) console.error(`skipped ${f}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "models") {
    const sub = rest[0];
    if (!sub) {
      for (const [k, v] of Object.entries(loadSlots(env))) console.log(`${k} = ${v ?? "(unset)"}`);
      return;
    }
    if (sub === "refresh") {
      const c = await refreshCatalog({ env });
      console.log(`catalog: ${c.length} models`);
      return;
    }
    if (sub === "set") {
      const [, slot, ref] = rest;
      if (!slot || !ref) fail("usage: ai-model-configure models set <slot> <provider/model>");
      const slots = loadSlots(env);
      if (!Object.hasOwn(slots, slot)) fail(`unknown slot: ${slot}`);
      slots[slot] = ref;
      saveSlots(slots, env);
      let n = 0;
      const failed = [];
      for (const d of loadDirs(env)) {
        const sel = selectorOf(d);
        if (!sel) continue;
        const v = loadVariant(sel.variant, env, d);
        if (v && Object.values(v.roles).some((r) => r.slot === slot)) {
          try {
            applyVariant(d, sel.variant);
            n++;
          } catch (err) {
            failed.push(`${d}: ${err.message}`);
          }
        }
      }
      console.log(`slot ${slot} → ${ref}; regenerated ${n} director${n === 1 ? "y" : "ies"}`);
      if (failed.length) {
        for (const f of failed) console.error(`skipped ${f}`);
        process.exit(1);
      }
      return;
    }
    fail(`unknown models subcommand: ${sub}`);
  }

  if (cmd === "fork") {
    if (!process.stdin.isTTY) fail("non-interactive: fork requires a TTY (or: use <variant> / patch)");
    const src = rest[0] ? { dir: cwd, variant: rest[0] } : nearestSelector(cwd);
    if (!src) fail("nothing to fork — no variant in this tree; use: fork <variant>");
    const r = resolveVariant(src.variant, env, src.dir);
    if (!r) fail(`unknown variant: ${src.variant}`);
    console.log(dim(`forking ${src.variant}${src.dir !== cwd ? ` from ${src.dir}` : ""} — copy saved beside the original with a new name, applied here`));
    const { variant: built, picks } = await runWizard({
      roles: resolveRoles({ cwd, env }),
      catalog: await discoverCatalog({ env }),
      slots: loadSlots(env),
      prefill: {
        description: r.variant.description,
        roles: r.variant.roles,
        denyProviders: r.variant.denyProviders,
        limits: r.variant.limits,
      },
    });
    applyPicks(picks, env);
    saveVariant(built, env, global ? null : r.scope);
    applyVariant(cwd, built.name);
    return;
  }

  if (cmd === "patch") {
    const [role, ref] = rest;
    if (!role || !ref) fail("usage: patch <role> <provider/model> — quick one-role change on the loaded variant");
    const known = resolveRoles({ cwd, env });
    if (!(role in known)) fail(`unknown role: ${role} (known: ${Object.keys(known).sort().join(", ")})`);
    const catalog = await discoverCatalog({ env });
    const warn = catalog.length && !catalog.some((m) => m.ref === ref)
      ? `warning: ${ref} is not in the catalog — typo? (try: models refresh)` : "";
    const own = selectorOf(cwd)?.variant;
    if (own) {
      const r = resolveVariant(own, env, cwd);
      if (!r) fail(`variant ${own} is missing (restore it, or: prune --force)`);
      const roles = structuredClone(r.variant.roles ?? {});
      roles[role] = { model: ref };
      saveVariant({ ...r.variant, roles }, env, r.scope);
      applyVariant(cwd, own);
      if (warn) console.error(warn);
      if (r.scope) console.log(dim(`note: ${own} is shared by everything under ${r.scope}`));
      return;
    }
    const src = nearestSelector(cwd);
    if (!src) fail("no variant loaded in this tree — run init first");
    const r = resolveVariant(src.variant, env, src.dir);
    if (!r) fail(`variant ${src.variant} is missing (restore it, or: prune --force)`);
    const newName = `${src.variant}-${role}`;
    if (loadVariant(newName, env, cwd)) fail(`${newName} already exists — run patch from a directory using it, or edit ${newName}`);
    const roles = structuredClone(r.variant.roles ?? {});
    roles[role] = { model: ref };
    saveVariant({
      ...r.variant,
      name: newName,
      description: `${r.variant.description || "patched"} (${role} → ${ref}, forked from ${src.variant})`,
      roles,
    }, env, global ? null : r.scope);
    applyVariant(cwd, newName);
    if (warn) console.error(warn);
    console.log(dim(`${newName} is an independent copy: other roles are a snapshot of ${src.variant} and will not follow later edits to it`));
    return;
  }

  if (cmd === "unmanage" || cmd === "detach" || cmd === "forget") {
    const targets = rest.length ? rest.map((d) => path.resolve(cwd, d)) : [path.resolve(cwd)];
    let touched = 0;
    for (const t of targets) {
      let dir;
      try {
        dir = fs.realpathSync(t);
      } catch {
        fail(`${t}: no such directory`);
      }
      const isReg = loadDirs(env).some((d) => {
        try {
          return fs.realpathSync(d) === dir;
        } catch {
          return d === dir;
        }
      });
      if (!isReg && !selectorOf(dir) && !fs.existsSync(path.join(dir, ".envrc"))) {
        console.log(`${dir}: not managed`);
        continue;
      }
      const r = unmanageDir(dir, { env });
      touched++;
      const parts = [
        r.envrcAction !== "none" ? r.envrcAction : null,
        r.hadSel ? "selector removed" : null,
        r.unregistered ? "registry entry removed" : null,
      ].filter(Boolean);
      console.log(`${dir}: ${parts.join(", ") || "nothing to remove"}`);
    }
    if (touched) console.log(dim("open a new shell (or run direnv reload) to drop the injected vars"));
    return;
  }

  if (cmd === "prune") {
    const dirs = loadDirs(env);
    const keep = [];
    const removed = [];
    let needsForce = 0;
    for (const d of dirs) {
      let exists = true;
      try {
        fs.accessSync(d);
      } catch {
        exists = false;
      }
      if (!exists) {
        removed.push(`${d} (directory gone)`);
        continue;
      }
      const sel = selectorOf(d);
      if (!sel && !fs.existsSync(path.join(d, ".envrc"))) {
        removed.push(`${d} (selector and .envrc already gone)`);
        continue;
      }
      if (sel && !loadVariant(sel.variant, env, d)) {
        if (force) {
          unmanageDir(d, { env });
          removed.push(`${d} (variant ${sel.variant} missing — unmanaged)`);
        } else {
          needsForce++;
          keep.push(d);
        }
        continue;
      }
      keep.push(d);
    }
    if (removed.length) writeDirs(keep, env);
    if (!removed.length && !needsForce) {
      console.log("registry clean — nothing to prune");
      return;
    }
    for (const r of removed) console.log(`pruned ${r}`);
    if (needsForce) console.log(`skipped ${needsForce} director${needsForce === 1 ? "y" : "ies"} with a missing variant — rerun with --force to unmanage them`);
    return;
  }

  if (cmd === "rm" || cmd === "remove" || cmd === "delete") {
    if (!rest[0]) fail("usage: rm <variant>");
    const file = variantFilePath(rest[0], env, cwd);
    if (!file) fail(`unknown variant: ${rest[0]}`);
    const users = loadDirs(env).filter((d) => selectorOf(d)?.variant === rest[0]);
    if (users.length && !force) fail(`${rest[0]} is used by:\n  ${users.join("\n  ")}\nre-point or unmanage those directories first (or --force)`);
    fs.rmSync(file);
    console.log(`removed variant ${rest[0]} ${dim(`(${file})`)}${users.length ? ` — ${users.length} dir${users.length === 1 ? "" : "s"} still reference it; run: prune --force` : ""}`);
    return;
  }

  if (cmd === "status") {
    const here = fs.realpathSync(cwd);
    const all = rest.includes("--all");
    const inTree = loadDirs(env).filter((d) => {
      if (all) return true;
      const rd = fs.realpathSync(d);
      return rd === here || here.startsWith(rd + "/");
    });
    if (!inTree.length) {
      console.log(`no environment in effect from here up${all ? "" : " (status --all lists every managed directory)"}`);
      return;
    }
    const groups = new Map();
    for (const d of inTree) {
      const sel = selectorOf(d);
      let state = "missing .envrc";
      try {
        const text = fs.readFileSync(`${d}/.envrc`, "utf8");
        const h = markerHash(text);
        state = h && h === contentHash(text) ? "ok" : "drifted";
      } catch { /* keep "missing .envrc" */ }
      if (sel && !loadVariant(sel.variant, env, d)) state = "variant missing";
      const vn = sel?.variant ?? "?";
      if (!groups.has(vn)) groups.set(vn, []);
      groups.get(vn).push({ dir: d, state });
    }
    const stateColor = { ok: "32", drifted: "33", "missing .envrc": "31", "variant missing": "31" };
    for (const [vn, dirs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const v = loadVariant(vn, env, dirs[0].dir);
      console.log(`\n${hi(bold(`◆ ${vn}`))}${v ? dim(` (${v.tier ?? "?"}) — ${v.description || "no description"}`) : c("31", " (variant missing)") + dim(" — restore the variant, or clean up: prune --force / unmanage <dir>")}`);
      for (const { dir, state } of dirs.sort((a, b) => a.dir.localeCompare(b.dir))) {
        console.log(`  ${dir}  ${c(stateColor[state] ?? "0", state)}`);
      }
    }
    const grouped = new Set(groups.keys());
    const avail = variantNames(env, cwd);
    if (avail.length) {
      console.log(`\n${hi(bold("◆ variants here"))}${dim(" — what use can apply from here; nearest store wins")}`);
      for (const n of avail) {
        const r = resolveVariant(n, env, cwd);
        if (!r) {
          console.log(`  ${n}  ${c("31", "broken file")}`);
          continue;
        }
        const store = r.scope ? `scoped: ${r.scope}` : `global: ${variantsDir(env)}`;
        const flags = [
          grouped.has(n) ? c("32", "in use") : null,
          r.scope && fs.existsSync(path.join(variantsDir(env), `${n}.json`)) ? dim("shadows global") : null,
        ].filter(Boolean);
        console.log(`  ${n}  ${dim(`[${store}]`)}${flags.length ? ` (${flags.join(dim(", "))})` : ""}`);
      }
    }
    if (!all) console.log(dim(`  scope: ${cwd} (status --all for every managed directory)`));
    return;
  }

  fail(`unknown command: ${cmd} (try: ai-model-configure help)`);
}
