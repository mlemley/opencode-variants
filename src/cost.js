const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const hi = (s) => c("1;36", s);
const free = (s) => c("32", s);

// [{ provider, models: [{ model, input, output, kind: paid|free|unknown }] }]
// kind sorts cheap-first, unknown last.
export function costGroups(catalog, providerFilter = null) {
  const groups = new Map();
  for (const m of catalog) {
    const slash = m.ref.indexOf("/");
    if (slash < 0) continue;
    const prov = m.ref.slice(0, slash);
    if (providerFilter && prov.toLowerCase() !== providerFilter.toLowerCase()) continue;
    if (!groups.has(prov)) groups.set(prov, []);
    const kind = !m.cost ? "unknown" : (!m.cost.input && !m.cost.output ? "free" : "paid");
    groups.get(prov).push({
      model: m.ref.slice(slash + 1),
      input: m.cost ? `$${m.cost.input ?? 0}` : "?",
      output: m.cost ? `$${m.cost.output ?? 0}` : "?",
      kind,
      sort: kind === "unknown" ? Infinity : (m.cost?.input ?? 0) + (m.cost?.output ?? 0),
    });
  }
  return [...groups.entries()]
    .map(([provider, models]) => ({
      provider,
      models: models.sort((a, b) => a.sort - b.sort || a.model.localeCompare(b.model)),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function costReport(catalog, providerFilter = null) {
  const groups = costGroups(catalog, providerFilter);
  if (!groups.length) return "";
  const width = Math.max(...groups.flatMap((g) => g.models.map((m) => m.model.length)));
  const inW = Math.max(3, ...groups.flatMap((g) => g.models.map((m) => m.input.length)));
  const outW = Math.max(4, ...groups.flatMap((g) => g.models.map((m) => m.output.length)));
  const lines = [];
  for (const g of groups) {
    lines.push(`\n${hi(bold(`◆ ${g.provider}`))} ${dim(`— ${g.models.length} model${g.models.length === 1 ? "" : "s"}`)}`);
    lines.push("");
    lines.push(`  ${dim("model".padEnd(width))}  ${dim("in".padStart(inW))}  ${dim("out".padStart(outW))}`);
    lines.push(`  ${dim("─".repeat(width))}  ${dim("─".repeat(inW))}  ${dim("─".repeat(outW))}`);
    for (const m of g.models) {
      const name = m.kind === "free" ? free(m.model.padEnd(width)) : m.model.padEnd(width);
      const i = m.kind === "unknown" ? dim(m.input.padStart(inW)) : m.input.padStart(inW);
      const o = m.kind === "unknown" ? dim(m.output.padStart(outW)) : m.output.padStart(outW);
      const tag = m.kind === "free" ? dim("   free") : m.kind === "unknown" ? dim("   cost unknown") : "";
      lines.push(`  ${name}  ${i}  ${o}${tag}`);
    }
  }
  lines.push(`\n${dim("  prices in USD per million tokens")}\n`);
  return `${lines.join("\n")}\n`;
}
