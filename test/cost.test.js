import test from "node:test";
import assert from "node:assert/strict";
import { costGroups, costReport } from "../src/cost.js";

const m = (ref, cost) => ({ ref, cost });

test("costGroups: kinds, cheap-first sort, case-insensitive filter", () => {
  const catalog = [
    m("beta/quick", { input: 1, output: 2 }),
    m("acme/big", { input: 3, output: 15 }),
    m("acme/small", { input: 0, output: 0 }),
    m("acme/odd", undefined),
  ];
  assert.deepEqual(costGroups(catalog), [
    {
      provider: "acme",
      models: [
        { model: "small", input: "$0", output: "$0", kind: "free", sort: 0 },
        { model: "big", input: "$3", output: "$15", kind: "paid", sort: 18 },
        { model: "odd", input: "?", output: "?", kind: "unknown", sort: Infinity },
      ],
    },
    {
      provider: "beta",
      models: [{ model: "quick", input: "$1", output: "$2", kind: "paid", sort: 3 }],
    },
  ]);
  assert.deepEqual(costGroups(catalog, "BETA").map((g) => g.provider), ["beta"]);
  assert.deepEqual(costGroups(catalog, "nope"), []);
});

test("costReport: aligned table per provider, no per-row price suffixes", () => {
  const report = costReport([m("acme/big", { input: 3, output: 15 }), m("acme/small", { input: 0, output: 0 })]);
  const lines = report.split("\n");
  assert.match(lines[1], /acme .*2 models/);
  assert.ok(report.includes("model"));
  assert.ok(report.includes("in"));
  assert.ok(report.includes("out"));
  assert.ok(!report.includes("out per"), "no 'out per' wording on rows");
  assert.ok(report.includes("free"), "free labelled once");
  assert.ok(report.includes("prices in USD per million tokens"));
  const bigRow = lines.find((l) => l.includes("big"));
  assert.ok(bigRow.includes("$3") && bigRow.includes("$15"));
  assert.ok(!bigRow.includes("per Mtok"));
  assert.equal(costReport([], "nope"), "");
});
