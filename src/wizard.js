import readline from "node:readline/promises";
import process from "node:process";
import { assertVariantName } from "./variants.js";

const PLACEMENT = {
  "all-cloud": {
    plan: ["reasoning", true], reviewer: ["reasoning", true],
    build: ["reasoning", true], explore: ["reasoning", true],
    executor: ["fast", false], general: ["fast", false],
  },
  "hybrid": {
    plan: ["reasoning", true], reviewer: ["reasoning", true],
    build: ["reasoning", false], explore: ["reasoning", false],
    executor: ["fast", false], general: ["fast", false],
  },
  "all-local": {
    plan: ["reasoning", false], reviewer: ["reasoning", false],
    build: ["reasoning", false], explore: ["reasoning", false],
    executor: ["fast", false], general: ["fast", false],
  },
};

export function placementFor(intent, role) {
  const row = Object.hasOwn(PLACEMENT, intent) ? PLACEMENT[intent] : null;
  const cell = row && Object.hasOwn(row, role) ? row[role] : null;
  return cell ? { pick: cell[0], concrete: cell[1] } : null;
}

export function slotFor(pick) {
  return pick === "reasoning" ? "model-reasoning" : "model-fast";
}

export function interviewPlan(roles) {
  return Object.entries(roles).map(([role, def]) => ({
    role,
    current: def.model || null,
    mode: def.mode || null,
    defaultVariant: def.variant || null,
  }));
}

export function answersToVariant({ name, tier, description, answers, denyProviders = [], limits = {} }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid variant name: ${name}`);
  const roles = {};
  for (const a of answers) {
    if (!a.slot && !a.model) throw new Error(`role ${a.role}: no model or slot`);
    roles[a.role] = {
      ...(a.slot ? { slot: a.slot } : { model: a.model }),
      ...(a.variant ? { variant: a.variant } : {}),
    };
  }
  const v = { name, tier, description, roles };
  if (denyProviders.length) v.denyProviders = [...denyProviders];
  if (Object.keys(limits).length) v.limits = limits;
  return v;
}

export function providersOf(catalog) {
  return [...new Set(catalog.map((m) => m.ref.split("/")[0]))].sort();
}

export function parseDeny(text, detected) {
  const t = text.trim();
  if (!t) return [];
  const only = t.match(/^only:(.*)$/i);
  if (only) {
    const keep = only[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return detected.filter((p) => !keep.includes(p.toLowerCase()));
  }
  const want = t.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return detected.filter((p) => want.includes(p.toLowerCase()));
}

export function parseLimits(text) {
  const limits = {};
  for (const part of text.split(";").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^([a-z0-9-]+)=(only|except):(.+)$/i);
    if (!m) throw new Error(`bad limit: ${part}`);
    const provider = m[1].toLowerCase();
    // Model ids are bare ("big") or full refs ("acme/big"); both mean the same here.
    const ids = m[3]
      .split(",")
      .map((s) => s.trim().toLowerCase().startsWith(`${provider}/`) ? s.trim().slice(provider.length + 1) : s.trim())
      .filter(Boolean);
    if (!ids.length) throw new Error(`bad limit: ${part}`);
    (limits[provider] ??= {})[m[2].toLowerCase() === "only" ? "allow" : "deny"] = ids;
  }
  return limits;
}

export function parseIntent(text, intents, fallback = "hybrid") {
  const t = text.trim();
  if (!t) return fallback;
  if (/^\d+$/.test(t)) return intents[Number(t) - 1] ?? null;
  return intents.find((i) => i.toLowerCase() === t.toLowerCase()) ?? null;
}

// Restriction editing answers: empty keeps, "-" clears, anything else replaces.
export function resolveEditAnswer(text) {
  const t = text.trim();
  if (!t) return { action: "keep" };
  if (t === "-") return { action: "clear" };
  return { action: "replace", value: t };
}

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const hi = (s) => c("1;36", s); // bright cyan: section headers
const ok = (s) => c("1;32", s); // green: resolved answers
const sec = (title) => console.log(`\n${hi(`◆ ${title}`)}`);

const MAX_VIEW = 10;

// Arrow-key list select with type-to-filter; Enter/Space picks, Esc goes
// back (resolves null). The caller must have closed its readline interface
// (a live readline on the same stdin would steal our keystrokes).
function selectRaw(title, items, show = (x) => String(x)) {
  return new Promise((resolve) => {
    let sel = 0; let top = 0; let query = ""; let nLines = 0;
    const matches = () => items
      .map((it) => ({ it, s: show(it) }))
      .filter(({ s }) => s.toLowerCase().includes(query.toLowerCase()));
    const render = () => {
      const ms = matches();
      if (sel >= ms.length) sel = Math.max(0, ms.length - 1);
      if (sel < top) top = sel;
      if (sel >= top + MAX_VIEW) top = sel - MAX_VIEW + 1;
      const lines = [
        `    ${hi(title)}${query ? dim(`  filter: ${query}`) : ""} ${dim("(↑↓ move · type filters · enter/space picks · ⌫/esc back)")}`,
      ];
      ms.slice(top, top + MAX_VIEW).forEach(({ s }, i) => {
        const idx = top + i;
        lines.push(idx === sel ? `    ${hi("▸")} ${bold(s)}` : `      ${dim(s)}`);
      });
      if (!ms.length) lines.push(`      ${dim("(no match — backspace to clear)")}`);
      if (ms.length > MAX_VIEW) lines.push(`      ${dim(`… ${ms.length - top - MAX_VIEW} more below`)}`);
      if (nLines) process.stdout.write(`\x1b[${nLines}A\x1b[J`);
      process.stdout.write(`${lines.join("\n")}\n`);
      nLines = lines.length;
    };
    const finish = (val, clear) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      if (clear && nLines) process.stdout.write(`\x1b[${nLines}A\x1b[J`);
      resolve(val);
    };
    const handle = (k) => {
      const ms = matches();
      if (k === "\x1b[A" || k === "\x1b[W") { if (sel > 0) sel--; }
      else if (k === "\x1b[B" || k === "\x1b[S") { if (sel < ms.length - 1) sel++; }
      else if (k === "\r" || k === "\n" || k === " ") { if (ms.length) { finish(ms[sel].it, true); return false; } return true; }
      else if (k === "\x7f" || k === "\b") {
        if (query) { query = ""; sel = 0; top = 0; }
        else { finish(null, true); return false; }
      }
      else if (k === "\x1b") { finish(null, true); return false; }
      else if (k === "\x03") { finish(null, true); process.exit(130); return false; }
      else if (/^[\x20-\x7e]$/.test(k)) { query += k; sel = 0; top = 0; }
      else return true;
      render();
      return true;
    };
    // Consume keystrokes one at a time: a chunk can mix typed text with
    // Enter/escape sequences (e.g. "small\r" pasted at speed).
    const onData = (b) => {
      const s = b.toString("utf8");
      for (let i = 0; i < s.length;) {
        const m = s.slice(i).match(/^\x1b\[[A-Z]/);
        const k = m ? m[0] : s[i];
        i += k.length;
        if (!handle(k)) return;
      }
    };
    process.stdin.on("data", onData);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render();
  });
}

async function selectFromText(rl, title, items, show) {
  console.log(`    ${title}`);
  items.forEach((it, i) => console.log(`      ${dim(`${i + 1}.`)} ${show(it)}`));
  for (;;) {
    const a = (await rl.question("    choose [number, Enter = back]: ")).trim();
    if (!a) return null;
    const pick = parseIntent(a, items.map((it) => show(it)), null);
    if (pick != null) return items.find((it) => show(it) === pick) ?? null;
    console.error(`    ${c("31", "✗")} pick one of the listed options`);
  }
}

export async function runWizard({ roles, catalog, slots = {}, prefill = {} }) {
  let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Selects take the raw TTY; readline must be detached meanwhile or it eats
  // arrow/Esc keystrokes and poisons the next question's line buffer.
  const select = (title, items, show) => {
    if (!process.stdin.isTTY) return selectFromText(rl, title, items, show);
    rl.close();
    return selectRaw(title, items, show).then((val) => {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return val;
    });
  };
  try {
    console.log(`${hi(bold("ov"))} ${dim("— build a routing variant; nothing is saved until the end.")}`);

    sec("your setup (from your opencode config + agents)");
    for (const { role, current, mode } of interviewPlan(roles)) {
      console.log(`    ${bold(role.padEnd(10))} ${dim("→")} ${current ?? dim("(no model)")}${mode ? dim(` (${mode})`) : ""}`);
    }

    sec(prefill.name ? `variant ${bold(prefill.name)} — Enter keeps the current value` : "new variant");
    let name;
    for (;;) {
      name = (await rl.question(`    name${prefill.name ? dim(` [${prefill.name}]`) : ""}: `)).trim() || prefill.name || "";
      try { assertVariantName(name); break; } catch (err) { console.log(dim(`  ${err.message} (lowercase, digits, hyphens; not a subcommand name)`)); }
    }
    const description = (await rl.question(`    description${prefill.description ? dim(` [${prefill.description}]`) : ""}: `)).trim() || prefill.description || "";

    const pickRef = {};
    for (const [k, v] of Object.entries(slots)) if (v) pickRef[k] = v;

    const byProvider = new Map();
    for (const m of catalog) {
      const p = m.ref.split("/")[0];
      if (!byProvider.has(p)) byProvider.set(p, []);
      byProvider.get(p).push(m);
    }
    const provNames = [...byProvider.keys()];

    const fmtTokens = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    const modelMeta = (m) => [
      m.context ? `ctx ${fmtTokens(m.context)}→${fmtTokens(m.output)}` : "",
      m.cost ? (m.cost.input || m.cost.output ? `$${m.cost.input}/$${m.cost.output}` : "free") : "",
      m.variants?.length ? `effort: ${m.variants.join(", ")}` : "",
    ].filter(Boolean).join("  ");

    const modelShow = (m) => {
      const meta = modelMeta(m);
      return meta ? `${m.ref}  ${meta}` : m.ref;
    };

    // provider list → filtered models → ref (all arrow-key menus)
    const browseModel = async () => {
      const prov = await select("provider", provNames, (p) => `${p} (${byProvider.get(p).length})`);
      if (!prov) return null;
      const ms = byProvider.get(prov);
      const sel = await select(`${prov} — ctx, $/Mtok in/out, efforts`, ms, modelShow);
      return sel ? sel.ref : null;
    };

    const plan = interviewPlan(roles);
    const askRole = async (role, def, keepVariant) => {
      for (;;) {
        const items = [];
        if (def) items.push({ t: "def", s: `(keep ${def})` });
        items.push({ t: "slot", slot: "model-reasoning", s: `(place on reasoning slot${pickRef["model-reasoning"] ? ` → ${pickRef["model-reasoning"]}` : ""})` });
        items.push({ t: "slot", slot: "model-fast", s: `(place on fast slot${pickRef["model-fast"] ? ` → ${pickRef["model-fast"]}` : ""})` });
        for (const p of provNames) items.push({ t: "prov", p, s: `${p} (${byProvider.get(p).length})` });
        const chosen = await select("model", items, (x) => x.s);
        if (!chosen) return null; // ⌫/esc: step back a role
        const a = { role };
        if (chosen.t === "def") {
          if (def.startsWith("slot:")) a.slot = def.slice(5);
          else a.model = def;
        } else if (chosen.t === "slot") {
          a.slot = chosen.slot;
        } else {
          const ms = byProvider.get(chosen.p);
          const sel = await select(`${chosen.p} — ctx, $/Mtok in/out, efforts`, ms, modelShow);
          if (!sel) continue;
          a.model = sel.ref;
        }
        const ref = a.slot ? (pickRef[a.slot] || "(unset)") : a.model;
        const entry = catalog.find((m) => m.ref === ref);
        if (entry?.variants?.length) {
          const keep = keepVariant && entry.variants.includes(keepVariant) ? keepVariant : null;
          const opts = keep ? [`(keep ${keep})`, "(none)", ...entry.variants] : ["(none)", ...entry.variants];
          const v = await select(`effort for ${ref}`, opts);
          if (v === null) continue;
          a.variant = keep && v === opts[0] ? keep : (v === "(none)" ? undefined : v);
        }
        console.log(a.slot
          ? `      ${ok("→")} ${role} ${dim("=")} ${ok(a.slot)} ${dim(`(${ref}${a.variant ? ` + ${a.variant}` : ""}, resolved at apply)`)}`
          : `      ${ok("→")} ${role} ${dim("=")} ${ok(a.model)}${a.variant ? dim(` + ${a.variant}`) : ""}`);
        return a;
      }
    };

    // intent + roles: stepping back past the first role rewinds to intent
    let intent = null;
    let answers = [];
    for (;;) {
      sec("intent — how roles get placed by default");
      const intents = Object.keys(PLACEMENT);
      for (;;) {
        intent = await select("intent", intents, (i) => (i === "hybrid" ? "hybrid (default)" : i));
        if (intent) break;
      }
      console.log(`    ${ok("→")} intent ${dim("=")} ${ok(intent)}`);

      sec(`roles — default first, then providers (${dim("↑↓ move · type filters · enter/space picks · ⌫/esc step back")})`);
      answers = [];
      let i = 0;
      let rewind = false;
      while (i < plan.length) {
        const { role, current } = plan[i];
        const vr = prefill.roles?.[role];
        const pl = placementFor(intent, role);
        const slotName = pl ? slotFor(pl.pick) : null;
        const placementDef = pl ? ((pl.concrete && pickRef[slotName]) || `slot:${slotName}`) : null;
        const def = (vr ? (vr.slot ? `slot:${vr.slot}` : vr.model) : null) ?? current ?? placementDef;
        console.log(`\n    ${bold(role)}`);
        const a = await askRole(role, def, vr?.variant);
        if (a === null) {
          if (answers.length) {
            answers.pop();
            i--;
          } else {
            rewind = true;
            break;
          }
          continue;
        }
        answers.push(a);
        i++;
      }
      if (!rewind) break;
    }

    const usedSlots = [...new Set(answers.map((a) => a.slot).filter(Boolean))];
    const newPicks = {};
    const unsetSlots = usedSlots.filter((s) => !pickRef[s]);
    if (unsetSlots.length) {
      sec(`slot models — what ${unsetSlots.join(", ")} resolve to (${dim("`models set` retargets them later")})`);
      for (const slot of unsetSlots) {
        console.log(`\n    ${bold(slot)}`);
        const r = await browseModel();
        if (r) {
          pickRef[slot] = r;
          newPicks[slot] = r;
          console.log(`    ${ok("→")} ${slot} ${dim("=")} ${ok(r)}`);
        } else {
          console.log(`      ${dim(`(left unset — roles using it fail until 'models set ${slot} <provider/model>')`)}`);
        }
      }
    }

    sec("restrictions (optional — Enter skips both)");
    const detected = providersOf(catalog);
    console.log(`    ${dim("providers detected:")} ${detected.join(", ") || dim("(none)")}`);

    const denyList = detected.slice(0, 2).join(", ") || "a, b";
    const onlyEx = detected[0] ? `only:${detected[0]}` : "only:a";
    const curDeny = prefill.denyProviders || [];
    if (curDeny.length) console.log(`    ${dim(`currently disabled: ${curDeny.join(", ")} — Enter keeps, "-" clears`)}`);
    console.log(`    ${dim(`disable whole providers — comma list (e.g. "${denyList}")`)}${detected[0] ? dim(`, or keep just some with "${onlyEx}"`) : ""}`);
    const denyAns = (await rl.question("    disable providers? ")).trim();
    let denyProviders;
    if (!denyAns) denyProviders = curDeny;
    else if (denyAns === "-") denyProviders = [];
    else denyProviders = parseDeny(denyAns, detected);
    if (denyProviders.length) console.log(`    ${ok("→")} disabled ${dim("=")} ${ok(denyProviders.join(", "))}`);

    const curLimits = prefill.limits || {};
    const curLines = Object.entries(curLimits).flatMap(([p, l]) =>
      [...(l.allow ? [`    ${p}=only:${l.allow.join(",")}`] : []),
        ...(l.deny ? [`    ${p}=except:${l.deny.join(",")}`] : [])]);
    if (curLines.length) {
      console.log(`\n    ${dim("current model limits:")}`);
      for (const line of curLines) console.log(dim(line));
      console.log(`    ${dim('Enter on a blank line keeps them, "-" clears, typed rules replace')}`);
    }
    console.log(`\n    ${dim("restrict which models stay visible per provider — one rule per line,")}`);
    console.log(`    ${dim("Enter on a blank line when done:")}`);
    console.log(`      ${dim("acme=only:big,small        → acme exposes only those two")}`);
    console.log(`      ${dim("beta=except:quick          → beta exposes everything but quick")}`);
    const entered = {};
    let cleared = false;
    for (;;) {
      const a = (await rl.question("    limit: ")).trim();
      if (!a) break;
      if (a === "-") { cleared = true; break; }
      try {
        Object.assign(entered, parseLimits(a));
      } catch (err) {
        console.error(`      ${c("31", "✗")} ${err.message} ${dim("— try provider=only:model,id or provider=except:model,id")}`);
      }
    }
    const limits = cleared
      ? {}
      : (Object.keys(entered).length ? entered : (curLines.length ? structuredClone(curLimits) : {}));
    for (const [p, l] of Object.entries(limits)) {
      if (l.allow) console.log(`    ${ok("→")} ${p} ${dim("allows only")} ${ok(l.allow.join(", "))}`);
      if (l.deny) console.log(`    ${ok("→")} ${p} ${dim("denies")} ${ok(l.deny.join(", "))}`);
    }

    const variant = answersToVariant({
      name,
      tier: { "all-cloud": "cloud", "all-local": "local" }[intent] || "hybrid",
      description,
      answers,
      denyProviders,
      limits,
    });
    console.log(`\n${ok("✓")} variant ${bold(variant.name)} ${dim(`(${variant.tier})`)} saved`);
    return { variant, picks: newPicks };
  } finally {
    rl.close();
  }
}

export async function editRestrictions({ catalog, variant }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const detected = providersOf(catalog);
    sec(`restrictions on "${variant.name}" — Enter keeps, "-" clears`);

    const curDeny = variant.denyProviders || [];
    console.log(`    ${dim("currently disabled:")} ${curDeny.length ? curDeny.join(", ") : dim("(none)")}`);
    console.log(`    ${dim('type providers to disable (comma list, or "only:a,b" to keep just those)')}`);
    let denyProviders = curDeny;
    for (;;) {
      const ans = resolveEditAnswer(await rl.question("    disable providers? "));
      if (ans.action === "keep") break;
      if (ans.action === "clear") { denyProviders = []; break; }
      try {
        denyProviders = parseDeny(ans.value, detected);
        break;
      } catch (err) {
        console.error(`      ${c("31", "✗")} ${err.message}`);
      }
    }
    if (denyProviders.length) console.log(`    ${ok("→")} disabled ${dim("=")} ${ok(denyProviders.join(", "))}`);

    const curLimits = variant.limits || {};
    const curLines = Object.entries(curLimits).flatMap(([p, l]) =>
      [...(l.allow ? [`    ${p}=only:${l.allow.join(",")}`] : []),
        ...(l.deny ? [`    ${p}=except:${l.deny.join(",")}`] : [])]);
    console.log(`\n    ${dim("current model limits:")}${curLines.length ? "" : dim(" (none)")}`);
    for (const line of curLines) console.log(dim(line));
    console.log(`    ${dim("to replace, type new rules one per line (one provider each);")}`);
    console.log(`    ${dim("Enter = keep current, \"-\" = clear all")}`);
    let limits = curLimits;
    let cleared = false;
    const entered = {};
    let touched = false;
    for (;;) {
      const a = (await rl.question("    limit: ")).trim();
      if (!a) break;
      if (a === "-") { cleared = true; break; }
      try {
        Object.assign(entered, parseLimits(a));
        touched = true;
      } catch (err) {
        console.error(`      ${c("31", "✗")} ${err.message} ${dim("— try provider=only:model,id or provider=except:model,id")}`);
      }
    }
    if (cleared) limits = {};
    else if (touched) limits = entered;
    return { denyProviders, limits };
  } finally {
    rl.close();
  }
}
