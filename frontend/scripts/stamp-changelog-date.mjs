// Dates the newest release heading in a changesets CHANGELOG.md.
//
// changesets writes "## 1.4.0" itself - its changelog formatter only shapes the
// entry lines - so the date is added as a post-step of `changeset version`
// (root script `version-packages`). Only the first "## " heading is looked at,
// and only when it has no date yet, so running this twice changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DATED = /\(\d{4}-\d{2}-\d{2}\)\s*$/;

export function stampChangelogDate(markdown, date) {
  const match = /^## .*$/m.exec(markdown);
  if (!match) return markdown;
  // `$` with the m flag stops before "\n" but not before "\r".
  const line = match[0].replace(/\r$/, "");
  if (DATED.test(line)) return markdown;
  const stamped = `${line.trimEnd()} (${date})`;
  return (
    markdown.slice(0, match.index) +
    stamped +
    markdown.slice(match.index + line.length)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(file, stampChangelogDate(readFileSync(file, "utf8"), today));
}
