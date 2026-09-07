import crypto from "node:crypto";

export function resolveRolesFor(variant, slots) {
  const out = {};
  for (const [role, sel] of Object.entries(variant.roles)) {
    const model = sel.slot
      ? (Object.hasOwn(slots, sel.slot) ? slots[sel.slot] : null)
      : sel.model;
    if (!model) {
      throw new Error(sel.slot
        ? `role ${role}: slot ${sel.slot} is not set (models set ${sel.slot} <provider/model>)`
        : `role ${role}: no model set`);
    }
    out[role] = { model, ...(sel.variant ? { variant: sel.variant } : {}) };
  }
  return out;
}

export function generateConfig(variant, slots) {
  const cfg = { agent: resolveRolesFor(variant, slots) };
  if (Array.isArray(variant.denyProviders) && variant.denyProviders.length) {
    cfg.disabled_providers = [...variant.denyProviders];
  }
  for (const [prov, l] of Object.entries(variant.limits || {})) {
    if (!l || typeof l !== "object") continue;
    cfg.provider ??= {};
    cfg.provider[prov] ??= {};
    if (Array.isArray(l.allow) && l.allow.length) cfg.provider[prov].whitelist = [...l.allow];
    if (Array.isArray(l.deny) && l.deny.length) cfg.provider[prov].blacklist = [...l.deny];
  }
  return cfg;
}

export function renderEnvrc(cfg, { variantName, cwd }) {
  const body = `export OPENCODE_CONFIG_CONTENT=${shq(JSON.stringify(cfg, null, 2))}\n\nPATH_add ${shq(`${cwd}/bin`)}\n`;
  return `# managed-by: opencode-variants ${variantName} @${sha256(body)}\n${body}`;
}

function shq(s) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function markerHash(text) {
  const m = text.match(/^# managed-by: opencode-variants \S+ @([0-9a-f]{64})/);
  return m ? m[1] : null;
}

export function contentHash(text) {
  const body = text.startsWith("# managed-by:") ? text.slice(text.indexOf("\n") + 1) : text;
  return sha256(body);
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
