import { parseConventionalTitle } from "./conventional-pr.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}

const title = args.join(" ").trim();

if (!title) {
  console.error("Usage: node scripts/check-pr-title.mjs <title>");
  process.exit(2);
}

const parsed = parseConventionalTitle(title);
if (!parsed.ok) {
  console.error(parsed.error);
  console.error(
    "Examples: feat(admin-ui): add repository browser, fix: repair publish token dialog, ci(release): draft rc releases",
  );
  process.exit(1);
}
