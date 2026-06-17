import { describe, it } from "node:test";
import assert from "node:assert/strict";
// The site builder is plain ESM JS run under node; its pure logic is extracted
// to a .mjs core so it can be unit-tested here under tsx.
import { entryFromRun, orderEntries, groupForRun, LEADERBOARD_DISCLOSURE } from "../scripts/site-data-core.mjs";

function fakeRun(overrides: Record<string, unknown> = {}) {
  const manifest = {
    runName: "r",
    entityName: "r",
    modelLabel: "r",
    systemType: "product-agent",
    entityType: "company",
    track: "agent",
    suiteHash: "h",
    ...(overrides.manifest as object ?? {}),
  };
  const summary = {
    averageOverall: 90,
    allPassRate: 50,
    criterionPassRate: 95,
    strictPassRate: 70,
    averageLatencyMs: 100,
    averagePerDim: { CRIT: 95, QUAL: 88, TERM: 100, GUIDE: 90, RAG: 92 },
    ...(overrides.summary as object ?? {}),
  };
  return { manifest, summary, results: [] };
}

describe("leaderboard site data segregation (conflict-of-interest)", () => {
  it("classifies production agent, raw model and fixture into distinct groups", () => {
    assert.equal(groupForRun({ systemType: "product-agent", track: "agent" }), "production");
    assert.equal(groupForRun({ systemType: "raw-model", track: "model" }), "model");
    assert.equal(groupForRun({ entityType: "model" }), "model");
    assert.equal(groupForRun({ systemType: "mini-agent" }), "calibration");
    assert.equal(groupForRun({ entityName: "mock-good baseline" }), "calibration");
  });

  it("never ranks a free/open model or fixture inside the production ranking", () => {
    const product = entryFromRun(fakeRun({ manifest: { entityName: "Laudos.AI", systemType: "product-agent", track: "agent" }, summary: { averageOverall: 80 } }));
    const model = entryFromRun(fakeRun({ manifest: { entityName: "raw-gpt", systemType: "raw-model", track: "model" }, summary: { averageOverall: 99 } }));
    const fixture = entryFromRun(fakeRun({ manifest: { entityName: "mock-good", systemType: "mini-agent" }, summary: { averageOverall: 100 } }));

    // Model scores higher than the product agent, but must still sit in its own
    // section below production, never promoted into the product ranking.
    const ordered = orderEntries([model, fixture, product]);
    assert.deepEqual(ordered.map((e) => e.group), ["production", "model", "calibration"]);
    assert.equal(ordered[0].system, "Laudos.AI");
    assert.equal(ordered[0].group, "production");
  });

  it("renders an external model row in a separate, clearly labeled section", () => {
    const model = entryFromRun(fakeRun({ manifest: { entityName: "external-model", systemType: "raw-model", track: "model" } }));
    assert.equal(model.group, "model");
    assert.equal(model.kind, "Free/open model");
  });

  it("ranks within the production group by clinical score", () => {
    const a = entryFromRun(fakeRun({ manifest: { entityName: "A" }, summary: { averageOverall: 70 } }));
    const b = entryFromRun(fakeRun({ manifest: { entityName: "B" }, summary: { averageOverall: 88 } }));
    const ordered = orderEntries([a, b]);
    assert.deepEqual(ordered.map((e) => e.system), ["B", "A"]);
  });

  it("disclosure states first-party, diagnostic-only, synthetic and radiologist-reviewed provenance", () => {
    const d = LEADERBOARD_DISCLOSURE.toLowerCase();
    assert.match(d, /first-party/);
    assert.match(d, /diagnostic/);
    assert.match(d, /never ranked against/);
    assert.match(d, /synthetic/);
    assert.match(d, /radiologists in sao paulo/);
    assert.match(d, /aggregate-only/);
  });
});
