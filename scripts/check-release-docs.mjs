#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  ".github/release-drafter.yml",
  ".github/workflows/release-drafter.yml",
  ".github/workflows/release-check.yml",
  "docs/release.md",
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    failures.push(`${file} is missing`);
  }
}

if (existsSync("README.md")) {
  const readme = readFileSync("README.md", "utf8");
  if (!readme.includes("docs/release.md")) {
    failures.push("README.md does not link to docs/release.md");
  }
}

if (existsSync("docs/release.md")) {
  const releaseDoc = readFileSync("docs/release.md", "utf8");
  for (const phrase of [
    "Release Drafter",
    "release/vX.Y.Z",
    "vX.Y.Z-rc.N",
    "type/feature",
    "pnpm verify",
  ]) {
    if (!releaseDoc.includes(phrase)) {
      failures.push(`docs/release.md does not mention ${JSON.stringify(phrase)}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`release docs check failed: ${failure}`);
  }
  process.exit(1);
}

console.log("release docs ok");
