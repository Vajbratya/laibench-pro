import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditReleaseFiles } from "./release-guard.js";

describe("auditReleaseFiles", () => {
  it("blocks raw private corpus files in private and public modes", () => {
    const issues = auditReleaseFiles([{ path: "data/private/laudos_clean_65k.csv" }], "private");
    assert.ok(issues.some((issue) => issue.rule === "raw-data-extension" && issue.severity === "error"));
    assert.ok(issues.some((issue) => issue.rule === "private-corpus-name" && issue.severity === "error"));
  });

  it("warns for tracked private case paths in private mode", () => {
    const issues = auditReleaseFiles([{ path: "cases/private/synthetic-demo.pt-BR.json", content: "[]" }], "private");
    assert.ok(issues.some((issue) => issue.rule === "private-path-tracked" && issue.severity === "warn"));
    assert.equal(issues.some((issue) => issue.severity === "error"), false);
  });

  it("blocks private paths and merged CSV markers in public mode", () => {
    const issues = auditReleaseFiles([
      { path: "cases/private/synthetic-demo.pt-BR.json", content: "[]" },
      { path: "leaderboard/frozen/reference-pt-BR.jsonl", content: '{"instance_id":"MERGED-PTBR-001"}' },
    ], "public");
    assert.ok(issues.some((issue) => issue.rule === "private-path-public-release"));
    assert.ok(issues.some((issue) => issue.rule === "public-derived-marker"));
  });

  it("does not flag documentation that describes private-derived marker rules", () => {
    const issues = auditReleaseFiles([
      { path: "README.md", content: "Do not publish MERGED-PTBR fixtures or merged-csv artifacts." },
    ], "public");
    assert.equal(issues.some((issue) => issue.rule === "public-derived-marker"), false);
  });

  it("blocks answer keys in public case files", () => {
    const issues = auditReleaseFiles([
      { path: "cases/public/synthetic-demo.en-US.json", content: '[{"goldFindings":[],"referenceReport":"x"}]' },
    ], "public");
    assert.ok(issues.some((issue) => issue.rule === "public-answer-key"));
  });

  it("allows small synthetic public docs in private mode", () => {
    const issues = auditReleaseFiles([
      { path: "cases/public/synthetic-demo.en-US.json", content: '[{"synthetic":true}]' },
      { path: "README.md", content: "No secrets here." },
    ], "private");
    assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  });
});
