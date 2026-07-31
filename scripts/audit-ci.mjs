#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const minimumSeverity = "high";
const severityRank = new Map([
  ["info", 0],
  ["low", 1],
  ["moderate", 2],
  ["high", 3],
  ["critical", 4],
]);

const allowlist = JSON.parse(readFileSync("docs/security/audit-allowlist.json", "utf8"));
validateAllowlist(allowlist);
const allowed = new Map(allowlist.allowed.map((entry) => [entry.id, entry]));
const pnpm = process.env.npm_execpath;
const pnpmIsScript = pnpm != null && /\.(?:cjs|mjs|js)$/i.test(pnpm);
const command = pnpmIsScript ? process.execPath : pnpm ?? commandForPlatform("pnpm");
const args = pnpmIsScript ? [pnpm, "audit", "--json"] : ["audit", "--json"];
const result = spawnSync(command, args, {
  encoding: "utf8",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

const output = (result.stdout ?? "").trim();
if (output.length === 0) {
  console.error(result.stderr.trim() || "pnpm audit produced no JSON output");
  process.exit(result.status ?? 1);
}

const report = JSON.parse(output);
const advisories = Object.values(report.advisories ?? {});
const failures = [];
const accepted = [];

for (const advisory of advisories) {
  const severity = String(advisory.severity);
  if ((severityRank.get(severity) ?? 0) < severityRank.get(minimumSeverity)) {
    continue;
  }

  const id = String(advisory.github_advisory_id ?? advisory.id);
  const allowedEntry = allowed.get(id);
  if (!allowedEntry) {
    failures.push(`${id} ${advisory.module_name}@${advisory.vulnerable_versions}: ${advisory.title}`);
    continue;
  }

  if (allowedEntry.package !== advisory.module_name) {
    failures.push(`${id} allowlist package mismatch: expected ${advisory.module_name}, got ${allowedEntry.package}`);
    continue;
  }

  accepted.push(`${id} ${advisory.module_name} (${severity}) allowed until ${allowedEntry.reviewBy}`);
}

for (const line of accepted) {
  console.warn(`audit allowlist: ${line}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`audit failed: ${failure}`);
  }
  process.exit(1);
}

console.log(`audit ok: ${accepted.length} allowlisted ${minimumSeverity}+ advisories, no new ${minimumSeverity}+ advisories`);

function validateAllowlist(value) {
  if (!value || !Array.isArray(value.allowed)) {
    console.error("audit allowlist must contain an allowed array");
    process.exit(1);
  }

  const seen = new Set();
  const today = new Date().toISOString().slice(0, 10);
  for (const [index, entry] of value.allowed.entries()) {
    const prefix = `audit allowlist entry ${index}`;
    for (const field of ["id", "package", "severity", "reason", "reviewBy"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim().length === 0) {
        console.error(`${prefix} is missing ${field}`);
        process.exit(1);
      }
    }
    if (!severityRank.has(entry.severity)) {
      console.error(`${prefix} has unknown severity ${JSON.stringify(entry.severity)}`);
      process.exit(1);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy)) {
      console.error(`${prefix} reviewBy must be YYYY-MM-DD`);
      process.exit(1);
    }
    if (entry.reviewBy < today) {
      console.error(`${prefix} expired on ${entry.reviewBy}`);
      process.exit(1);
    }
    if (seen.has(entry.id)) {
      console.error(`${prefix} duplicates ${entry.id}`);
      process.exit(1);
    }
    seen.add(entry.id);
  }
}

function commandForPlatform(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}
