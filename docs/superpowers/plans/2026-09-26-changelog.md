# Versioning, Changelog & Release Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version the app with changesets, show the version in the header, open an in-app changelog from it, and let an admin announce a release as a clickable marquee banner.

**Architecture:** changesets writes `frontend/CHANGELOG.md` through a "Version Packages" PR; Vite bundles that file (`?raw`) and the package version (`define`), a pure parser turns it into releases, and a `modal-panel` dialog renders them. A release banner is an ordinary `banners` row plus a `release_version` column; the marquee renders its text as a button, and `useTurntable` learns to tell a tap from a scratch.

**Tech Stack:** `@changesets/cli` + `@changesets/changelog-github`, `changesets/action@v1`, React 19 + Vite 6 + Vitest, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-09-26-changelog-design.md`

## Global Constraints

- Quote style in TS/TSX: double quotes `"` (Prettier rewrites `'` on save).
- Commits: `ELO-9: <summary>`, **no** `Co-Authored-By` trailer.
- The versioned package is `toegg-elo-frontend`; its `version` is the app version. It gets `"private": true`.
- `CHANGELOG.md` lives at `frontend/CHANGELOG.md`.
- Changelog entries and the release banner text are **English only**; UI chrome (dialog title, buttons, admin controls) goes through i18n in `en.json` **and** `de.json` (Swiss spelling: "ss", never "ß").
- Dates render with `DATE_LOCALE` from `lib/i18n.ts` (dd.mm.yyyy).
- Release banner defaults: audience `everyone`, starts now, ends after `RELEASE_BANNER_DAYS = 14`, active.
- Only `http(s)` links from the changelog are ever rendered as `<a>`.
- Pure logic goes in `frontend/src/lib/*` with no DB calls; DB access only through `frontend/src/lib/supabase.ts`.
- Pre-commit runs `pnpm lint && pnpm test` (frontend) and `deno lint && deno test -A`. Never skip hooks.

## Review Focus

1. **Brand-new `CHANGELOG.md` with no releases yet**: chip still shows `v1.0.0`, dialog opens and says "No releases yet." (test in Task 3).
2. **Tap on a hidden (`aria-hidden`) copy of the release link**: most of the time the copy on screen is the 2nd or 3rd. It must still open the changelog (test in Task 5).
3. **One tap opens exactly once**: the hook's tap and the browser's native `click` must not both fire; keyboard Enter (a `click` with `detail === 0`) must still work (tests in Task 5).
4. **Re-announcing after deleting the release banner**: the Announce button goes from "Already announced" back to enabled when the row is gone; a failed insert (e.g. unique-index race) shows an error rather than failing silently (tests in Task 4).
5. **Release banner for a version not in the bundled changelog** (e.g. announced on a newer deployment): the dialog opens with nothing focused and doesn't crash (test in Task 3).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `package.json` (root) | modify | changesets devDeps + `version-packages` / `tag-release` scripts |
| `.changeset/config.json`, `.changeset/README.md` | create | changesets config; per-PR convention |
| `.changeset/elo-9-changelog.md` | create | this feature's own changeset |
| `.github/workflows/release.yml` | create | Version PR + tag + GitHub Release |
| `frontend/package.json` | modify | `"private": true` |
| `frontend/CHANGELOG.md` | create | seed file (title only) that changesets prepends to |
| `frontend/scripts/stamp-changelog-date.mjs` (+ `.test.mjs`) | create | dates the newest release heading |
| `frontend/src/lib/changelog.ts` (+ test) | create | pure parser + inline tokenizer |
| `frontend/src/vite-env.d.ts` | create | `vite/client` types + `__APP_VERSION__` |
| `frontend/vite.config.ts` | modify | `define.__APP_VERSION__` |
| `frontend/src/lib/appChangelog.ts` | create | bundled `APP_VERSION` + parsed `RELEASES` |
| `frontend/src/components/ChangelogDialog.tsx` (+ test) | create | the dialog |
| `frontend/src/App.tsx` | modify | version chip, dialog state, props to banner + admin |
| `frontend/src/App.css` | modify | chip, dialog, banner-link styles |
| `frontend/src/locales/{en,de}.json` | modify | `changelog.*`, `bannerAdmin.*` keys |
| `supabase/migrations/20260926_release_banners.sql` | create | `release_version` column + unique index |
| `frontend/src/lib/banners.ts` (+ test) | modify | `Banner.release_version`, release helpers |
| `frontend/src/lib/supabase.ts` | modify | `announceRelease` |
| `frontend/src/components/BannerAdmin.tsx` (+ new test) | modify | Announce control + Release badge |
| `frontend/src/lib/turntable.ts` (+ test) | modify | `isTap` |
| `frontend/src/hooks/useTurntable.ts` | modify | `onTap` + click swallowing |
| `frontend/src/components/MessageBanner.tsx` (+ test) | modify | release link rendering |
| `CLAUDE.md`, `README.md` | modify | docs |

---

### Task 1: changesets, release workflow, date stamp

**Files:**
- Modify: `package.json`, `frontend/package.json`
- Create: `.changeset/config.json`, `.changeset/README.md`, `.changeset/elo-9-changelog.md`, `.github/workflows/release.yml`, `frontend/CHANGELOG.md`, `frontend/scripts/stamp-changelog-date.mjs`, `frontend/scripts/stamp-changelog-date.test.mjs`

**Interfaces:**
- Produces: `frontend/CHANGELOG.md` (exists from now on, so later `?raw` imports resolve); `stampChangelogDate(markdown: string, date: string): string`; root scripts `version-packages`, `tag-release`.

- [ ] **Step 1: Install changesets at the workspace root**

Run (from repo root): `pnpm add -Dw @changesets/cli @changesets/changelog-github`
Expected: both appear in root `package.json` devDependencies; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Initialise and configure**

Run: `pnpm changeset init` (creates `.changeset/config.json` and `.changeset/README.md`). Then replace `.changeset/config.json` with:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "miltronius/toegg-elo" }
  ],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "privatePackages": { "version": true, "tag": true }
}
```

Replace `.changeset/README.md` with:

```markdown
# Changesets

Every PR that changes something a player or developer would notice adds one:

    pnpm changeset

Pick `patch` (fix), `minor` (feature) or `major` (big change), then write the note:

- **First line:** what changed, written for a player. It is what the in-app
  changelog shows. e.g. "Goal achievements: Flawless Victory, Fatality and
  goal-count tiers".
- **Further lines (optional):** technical detail for developers. The changelog
  shows it behind "Details".

Purely internal PRs (CI, refactors) can skip it. changeset-bot comments on the
PR either way.

Releasing: merging to `main` updates the "Release: version packages" PR.
Merging *that* PR bumps the version, writes `frontend/CHANGELOG.md` and tags
the release. Announce it from Admin → Message Banner → Announce.
```

- [ ] **Step 3: Root scripts and private frontend package**

Root `package.json` becomes (keep whatever versions Step 1 installed):

```json
{
  "private": true,
  "devDependencies": {
    "@changesets/changelog-github": "<as installed>",
    "@changesets/cli": "<as installed>",
    "husky": "^9.1.7"
  },
  "scripts": {
    "prepare": "husky",
    "changeset": "changeset",
    "version-packages": "changeset version && node frontend/scripts/stamp-changelog-date.mjs frontend/CHANGELOG.md",
    "tag-release": "changeset tag"
  }
}
```

In `frontend/package.json`, add `"private": true,` directly after `"version": "1.0.0",`.

Create `frontend/CHANGELOG.md` with exactly:

```markdown
# toegg-elo-frontend
```

(changesets inserts each release below this title line.)

- [ ] **Step 4: Write the failing test for the date stamp**

`frontend/scripts/stamp-changelog-date.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { stampChangelogDate } from "./stamp-changelog-date.mjs";

const DATE = "2026-09-26";

describe("stampChangelogDate", () => {
  it("dates the newest release heading", () => {
    const md = "# toegg-elo-frontend\n\n## 1.1.0\n\n### Minor Changes\n\n- x\n\n## 1.0.1 (2026-09-01)\n";
    expect(stampChangelogDate(md, DATE)).toBe(
      "# toegg-elo-frontend\n\n## 1.1.0 (2026-09-26)\n\n### Minor Changes\n\n- x\n\n## 1.0.1 (2026-09-01)\n",
    );
  });

  it("leaves an already dated heading alone, so re-running is harmless", () => {
    const md = "# t\n\n## 1.1.0 (2026-09-20)\n\n- x\n";
    expect(stampChangelogDate(md, DATE)).toBe(md);
  });

  it("never touches an older undated heading", () => {
    const md = "# t\n\n## 1.1.0 (2026-09-20)\n\n## 1.0.0\n";
    expect(stampChangelogDate(md, DATE)).toBe(md);
  });

  it("does nothing when there is no release yet", () => {
    expect(stampChangelogDate("# t\n", DATE)).toBe("# t\n");
  });

  it("keeps Windows line endings intact", () => {
    const md = "# t\r\n\r\n## 1.1.0\r\n\r\n- x\r\n";
    expect(stampChangelogDate(md, DATE)).toBe("# t\r\n\r\n## 1.1.0 (2026-09-26)\r\n\r\n- x\r\n");
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run (from `frontend/`): `pnpm vitest run scripts/stamp-changelog-date.test.mjs`
Expected: FAIL, cannot resolve `./stamp-changelog-date.mjs`.

- [ ] **Step 6: Implement**

`frontend/scripts/stamp-changelog-date.mjs`:

```js
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
```

- [ ] **Step 7: Run it to see it pass**

Run: `pnpm vitest run scripts/stamp-changelog-date.test.mjs`
Expected: 5 passed.

- [ ] **Step 8: Release workflow**

`.github/workflows/release.yml`:

```yaml
name: Release

# Keeps a "Release: version packages" PR open while there are pending
# changesets. Merging that PR bumps frontend/package.json, writes
# frontend/CHANGELOG.md, and this same workflow then tags the release and
# creates the GitHub Release (publish step - nothing goes to npm).
on:
  push:
    branches: ["main"]

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 10
          run_install: false

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - uses: changesets/action@v1
        with:
          version: pnpm run version-packages
          publish: pnpm run tag-release
          title: "Release: version packages"
          commit: "Release: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 9: This feature's own changeset**

`.changeset/elo-9-changelog.md`:

```markdown
---
"toegg-elo-frontend": minor
---

Changelog: click the version number next to the title to see what's new in each release.

Adds changesets-based versioning with a release workflow ("Release: version packages" PR, tags, GitHub Releases), the in-app changelog dialog, and an admin "Announce" button that creates a release banner linking to it.
```

- [ ] **Step 10: Verify changesets sees the package**

Run (repo root): `pnpm changeset status`
Expected: lists `toegg-elo-frontend` with a `minor` bump. Do **not** run `pnpm run version-packages` locally (it needs `GITHUB_TOKEN` and would consume the changeset).

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml .changeset .github/workflows/release.yml frontend/package.json frontend/CHANGELOG.md frontend/scripts
git commit -m "ELO-9: Version with changesets, release workflow, date stamp"
```

---

### Task 2: Changelog parser

**Files:**
- Create: `frontend/src/lib/changelog.ts`, `frontend/src/lib/changelog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChangeKind = "major" | "minor" | "patch" | "other";
  export interface ChangelogEntry { summary: string; details: string | null; prNumber: number | null; prUrl: string | null; author: string | null }
  export interface ChangelogSection { kind: ChangeKind; title: string; entries: ChangelogEntry[] }
  export interface Release { version: string; date: string | null; sections: ChangelogSection[] }
  export function parseChangelog(markdown: string): Release[]
  export type InlineToken = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "link"; text: string; href: string };
  export function inlineTokens(text: string): InlineToken[]
  ```

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/changelog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inlineTokens, parseChangelog } from "./changelog";

// What @changesets/changelog-github writes, plus a hand-written older release.
const FIXTURE = `# toegg-elo-frontend

## 1.2.0 (2026-10-02)

### Minor Changes

- [#125](https://github.com/miltronius/toegg-elo/pull/125) [\`c26d746\`](https://github.com/miltronius/toegg-elo/commit/c26d746) Thanks [@miltronius](https://github.com/miltronius)! - Goal achievements: Flawless Victory, Fatality and goal-count tiers

  \`teamGoals\` counts an empty field as 10 for the winner.

  Pair tiers carry \`meta.partnerId\`.

### Patch Changes

- [\`7c5382f\`](https://github.com/miltronius/toegg-elo/commit/7c5382f) Thanks [@a](https://github.com/a), [@b](https://github.com/b)! - Fix team ranking - ties now sort by name

## 1.1.0

- Relationship graph
- Message banners
`;

describe("parseChangelog", () => {
  const releases = parseChangelog(FIXTURE);

  it("reads releases newest first, with or without a date", () => {
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ["1.2.0", "2026-10-02"],
      ["1.1.0", null],
    ]);
  });

  it("maps changesets section headings to kinds", () => {
    expect(releases[0].sections.map((s) => [s.kind, s.title])).toEqual([
      ["minor", "Minor Changes"],
      ["patch", "Patch Changes"],
    ]);
  });

  it("splits a changelog-github line into PR, author and summary", () => {
    const entry = releases[0].sections[0].entries[0];
    expect(entry).toMatchObject({
      summary:
        "Goal achievements: Flawless Victory, Fatality and goal-count tiers",
      prNumber: 125,
      prUrl: "https://github.com/miltronius/toegg-elo/pull/125",
      author: "miltronius",
    });
  });

  it("keeps the indented lines under an entry as its details", () => {
    expect(releases[0].sections[0].entries[0].details).toBe(
      "`teamGoals` counts an empty field as 10 for the winner.\n\nPair tiers carry `meta.partnerId`.",
    );
  });

  it("handles a commit-only line with several authors, and a ' - ' inside the summary", () => {
    expect(releases[0].sections[1].entries[0]).toMatchObject({
      summary: "Fix team ranking - ties now sort by name",
      prNumber: null,
      prUrl: null,
      author: "a",
      details: null,
    });
  });

  it("accepts hand-written bare entries outside any section", () => {
    expect(releases[1].sections).toEqual([
      {
        kind: "other",
        title: "",
        entries: [
          { summary: "Relationship graph", details: null, prNumber: null, prUrl: null, author: null },
          { summary: "Message banners", details: null, prNumber: null, prUrl: null, author: null },
        ],
      },
    ]);
  });

  it("returns nothing for a changelog with no release yet", () => {
    expect(parseChangelog("# toegg-elo-frontend\n")).toEqual([]);
    expect(parseChangelog("")).toEqual([]);
  });

  it("reads CRLF files the same as LF", () => {
    expect(parseChangelog(FIXTURE.replace(/\n/g, "\r\n"))).toEqual(releases);
  });

  it("keeps a stray paragraph as plain text instead of throwing", () => {
    const [release] = parseChangelog("## 2.0.0\n\nSomething odd here\n");
    expect(release.sections[0].entries[0].summary).toBe("Something odd here");
  });

  it("drops sections left empty", () => {
    const [release] = parseChangelog("## 2.0.0\n\n### Patch Changes\n\n### Minor Changes\n\n- x\n");
    expect(release.sections.map((s) => s.kind)).toEqual(["minor"]);
  });
});

describe("inlineTokens", () => {
  it("splits code and links out of text", () => {
    expect(inlineTokens("Use `pnpm changeset`, see [docs](https://x.dev/a) now")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "pnpm changeset" },
      { kind: "text", text: ", see " },
      { kind: "link", text: "docs", href: "https://x.dev/a" },
      { kind: "text", text: " now" },
    ]);
  });

  it("never turns a non-http link into a link", () => {
    expect(inlineTokens("[click](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[click](javascript:alert(1))" },
    ]);
  });

  it("returns plain text as one token", () => {
    expect(inlineTokens("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run (from `frontend/`): `pnpm vitest run src/lib/changelog.test.ts`
Expected: FAIL, cannot resolve `./changelog`.

- [ ] **Step 3: Implement**

`frontend/src/lib/changelog.ts`:

```ts
/**
 * Reads the CHANGELOG.md changesets writes (via @changesets/changelog-github)
 * into releases for the in-app changelog. Also accepts hand-written entries - a
 * bare "- summary" line, optionally outside any "###" section - so seeded
 * history fits. Never throws: a line it cannot place becomes a plain-text entry
 * rather than breaking the dialog. No DB calls.
 */

export type ChangeKind = "major" | "minor" | "patch" | "other";

export interface ChangelogEntry {
  /** First line of the changeset - written for players. */
  summary: string;
  /** Remaining lines - developer detail. */
  details: string | null;
  prNumber: number | null;
  prUrl: string | null;
  author: string | null;
}

export interface ChangelogSection {
  kind: ChangeKind;
  /** The heading as written; empty for entries outside any section. */
  title: string;
  entries: ChangelogEntry[];
}

export interface Release {
  version: string;
  /** From "## 1.4.0 (2026-09-26)"; see frontend/scripts/stamp-changelog-date.mjs. */
  date: string | null;
  sections: ChangelogSection[];
}

const RELEASE_HEADING = /^##\s+(\S+)(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const ENTRY_LINE = /^[-*]\s+(.*)$/;
const PR_LINK = /^\[#(\d+)\]\(([^)]+)\)\s*/;
const COMMIT_LINK = /^\[`[0-9a-f]+`\]\([^)]+\)\s*/;
const THANKS =
  /^Thanks\s+\[@([^\]]+)\]\([^)]+\)(?:,?\s*(?:and\s+)?\[@[^\]]+\]\([^)]+\))*!\s*/;

const KINDS: Record<string, ChangeKind> = {
  "major changes": "major",
  "minor changes": "minor",
  "patch changes": "patch",
};

function plainEntry(summary: string): ChangelogEntry {
  return { summary, details: null, prNumber: null, prUrl: null, author: null };
}

/**
 * changelog-github prefixes the summary with "[#PR](url) [`sha`](url) Thanks
 * [@user](url)! - ", every part optional. A line without that prefix is a
 * hand-written summary; one whose prefix doesn't end in " - " is kept whole.
 */
function parseEntryLine(text: string): ChangelogEntry {
  let rest = text;
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  let author: string | null = null;

  const pr = PR_LINK.exec(rest);
  if (pr) {
    prNumber = Number(pr[1]);
    prUrl = pr[2];
    rest = rest.slice(pr[0].length);
  }
  const commit = COMMIT_LINK.exec(rest);
  if (commit) rest = rest.slice(commit[0].length);
  const thanks = THANKS.exec(rest);
  if (thanks) {
    author = thanks[1];
    rest = rest.slice(thanks[0].length);
  }

  if (!pr && !commit && !thanks) return plainEntry(text.trim());
  if (!rest.startsWith("- ")) return plainEntry(text.trim());
  return { summary: rest.slice(2).trim(), details: null, prNumber, prUrl, author };
}

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ChangelogSection | null = null;
  let entry: ChangelogEntry | null = null;
  let details: string[] = [];

  const closeEntry = () => {
    if (entry) {
      const text = details.join("\n").trim();
      entry.details = text === "" ? null : text;
    }
    entry = null;
    details = [];
  };

  const addEntry = (next: ChangelogEntry) => {
    if (!release) return;
    if (!section) {
      section = { kind: "other", title: "", entries: [] };
      release.sections.push(section);
    }
    section.entries.push(next);
    entry = next;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      closeEntry();
      section = null;
      release = { version: heading[1], date: heading[2] ?? null, sections: [] };
      releases.push(release);
      continue;
    }
    // The "# package-name" title and anything before the first release.
    if (!release) continue;

    const sub = SECTION_HEADING.exec(line);
    if (sub) {
      closeEntry();
      section = {
        kind: KINDS[sub[1].toLowerCase()] ?? "other",
        title: sub[1],
        entries: [],
      };
      release.sections.push(section);
      continue;
    }

    const item = ENTRY_LINE.exec(line);
    if (item) {
      closeEntry();
      addEntry(parseEntryLine(item[1]));
      continue;
    }

    // Detail lines are indented two spaces under their entry; blank lines
    // between paragraphs belong to it too (trimmed off the ends later).
    if (entry && (line.trim() === "" || /^\s/.test(line))) {
      details.push(line.replace(/^ {1,2}/, ""));
      continue;
    }
    if (line.trim() === "") continue;

    closeEntry();
    addEntry(plainEntry(line.trim()));
  }
  closeEntry();

  return releases.map((r) => ({
    ...r,
    sections: r.sections.filter((s) => s.entries.length > 0),
  }));
}

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/** Only http(s) targets become links - a changelog line must never run script. */
const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * The only inline markdown the changelog renders: `code` and [links](https://…).
 * Everything else stays literal text.
 */
export function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "text", text: text.slice(last, index) });
    if (match[1] !== undefined) tokens.push({ kind: "code", text: match[1] });
    else tokens.push({ kind: "link", text: match[2], href: match[3] });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm vitest run src/lib/changelog.test.ts`
Expected: all pass. If the TS compiler narrows `section`/`entry` to `null` inside the loop (closures assigning them), vitest still runs; confirm with `pnpm exec tsc --noEmit 2>&1 | grep changelog.ts` and, if it reports errors, switch those two variables to a single `const state: { section: ChangelogSection | null; entry: ChangelogEntry | null }` object.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/changelog.ts frontend/src/lib/changelog.test.ts
git commit -m "ELO-9: Parse the changesets changelog"
```

---

### Task 3: Version chip + Changelog dialog

**Files:**
- Create: `frontend/src/vite-env.d.ts`, `frontend/src/lib/appChangelog.ts`, `frontend/src/components/ChangelogDialog.tsx`, `frontend/src/components/ChangelogDialog.test.tsx`
- Modify: `frontend/vite.config.ts`, `frontend/src/App.tsx` (header ~line 299, state ~line 195, end of JSX), `frontend/src/App.css`, `frontend/src/locales/en.json`, `frontend/src/locales/de.json`

**Interfaces:**
- Consumes: `parseChangelog`, `inlineTokens`, `Release`, `ChangelogEntry` (Task 2); `frontend/CHANGELOG.md` (Task 1).
- Produces: `APP_VERSION: string`, `RELEASES: Release[]` from `lib/appChangelog.ts`; `ChangelogDialog({ releases, focusVersion, onClose })`; in `App.tsx`, `openChangelog(version: string | null): void`.

- [ ] **Step 1: Build-time version**

`frontend/vite.config.ts`:

```ts
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The app version is frontend/package.json's, which the release workflow bumps.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

`frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

/** frontend/package.json's version, injected by vite.config.ts at build time. */
declare const __APP_VERSION__: string;
```

(The `vite/client` reference also clears the pre-existing `import.meta.env` tsc errors in `supabase.ts`, and types `?raw` imports.)

`frontend/src/lib/appChangelog.ts`:

```ts
import changelogMarkdown from "../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

/**
 * The version and changelog this bundle was built from. Both are compiled in,
 * so the dialog needs no fetch and always matches what is deployed.
 */
export const APP_VERSION: string = __APP_VERSION__;
export const RELEASES = parseChangelog(changelogMarkdown);
```

- [ ] **Step 2: i18n keys**

`en.json`, new top-level block after `"banner"`:

```json
"changelog": {
  "title": "What's new",
  "open": "Show what's new",
  "close": "Close",
  "empty": "No releases yet.",
  "details": "Details",
  "kinds": {
    "major": "Big changes",
    "minor": "New",
    "patch": "Fixes"
  }
},
```

`de.json`, same place:

```json
"changelog": {
  "title": "Was ist neu",
  "open": "Neuigkeiten anzeigen",
  "close": "Schliessen",
  "empty": "Noch keine Releases.",
  "details": "Details",
  "kinds": {
    "major": "Grosse Änderungen",
    "minor": "Neu",
    "patch": "Fehlerbehebungen"
  }
},
```

- [ ] **Step 3: Write the failing dialog tests**

`frontend/src/components/ChangelogDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangelogDialog } from "./ChangelogDialog";
import type { Release } from "../lib/changelog";

const RELEASES: Release[] = [
  {
    version: "1.2.0",
    date: "2026-10-02",
    sections: [
      {
        kind: "minor",
        title: "Minor Changes",
        entries: [
          {
            summary: "Goal achievements with `teamGoals`",
            details: "Pair tiers carry meta.partnerId.",
            prNumber: 125,
            prUrl: "https://github.com/miltronius/toegg-elo/pull/125",
            author: "miltronius",
          },
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    date: null,
    sections: [
      {
        kind: "other",
        title: "",
        entries: [
          { summary: "Relationship graph", details: null, prNumber: null, prUrl: null, author: null },
        ],
      },
    ],
  },
];

function setup(props: Partial<React.ComponentProps<typeof ChangelogDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <ChangelogDialog releases={RELEASES} focusVersion={null} onClose={onClose} {...props} />,
  );
  return { onClose };
}

describe("ChangelogDialog", () => {
  it("lists releases newest first with a Swiss date", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["v1.2.002.10.2026", "v1.1.0"]);
  });

  it("names sections by kind and renders inline code", () => {
    setup();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("teamGoals").tagName).toBe("CODE");
  });

  it("links the PR and keeps developer detail behind Details", () => {
    setup();
    expect(screen.getByRole("link", { name: "#125" })).toHaveAttribute(
      "href",
      "https://github.com/miltronius/toegg-elo/pull/125",
    );
    expect(screen.getByText("Details").closest("details")).not.toHaveAttribute("open");
  });

  it("says so when there are no releases yet", () => {
    setup({ releases: [] });
    expect(screen.getByText("No releases yet.")).toBeInTheDocument();
  });

  it("highlights the release it was opened for", () => {
    setup({ focusVersion: "1.1.0" });
    const focused = document.querySelector(".changelog-release--focus");
    expect(focused?.querySelector("h3")?.textContent).toBe("v1.1.0");
  });

  it("opens without a highlight for a version it doesn't know", () => {
    setup({ focusVersion: "9.9.9" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.querySelector(".changelog-release--focus")).toBeNull();
  });

  it("closes on Escape and on the backdrop, not on the panel", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("changelog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run to see it fail**

Run: `pnpm vitest run src/components/ChangelogDialog.test.tsx`
Expected: FAIL, cannot resolve `./ChangelogDialog`.

- [ ] **Step 5: Implement the dialog**

`frontend/src/components/ChangelogDialog.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { inlineTokens, type ChangelogEntry, type Release } from "../lib/changelog";
import { DATE_LOCALE } from "../lib/i18n";

interface ChangelogDialogProps {
  releases: Release[];
  /** Scrolled to and highlighted; unknown versions are simply ignored. */
  focusVersion: string | null;
  onClose: () => void;
}

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) =>
        token.kind === "code" ? (
          <code key={i}>{token.text}</code>
        ) : token.kind === "link" ? (
          <a key={i} href={token.href} target="_blank" rel="noreferrer">
            {token.text}
          </a>
        ) : (
          <span key={i}>{token.text}</span>
        ),
      )}
    </>
  );
}

function Entry({ entry }: { entry: ChangelogEntry }) {
  const { t } = useTranslation();
  return (
    <li className="changelog-entry">
      <InlineText text={entry.summary} />
      {entry.prUrl && (
        <>
          {" "}
          <a className="changelog-pr" href={entry.prUrl} target="_blank" rel="noreferrer">
            #{entry.prNumber}
          </a>
        </>
      )}
      {entry.details && (
        <details className="changelog-details">
          <summary>{t("changelog.details")}</summary>
          <p className="whitespace-pre-line">
            <InlineText text={entry.details} />
          </p>
        </details>
      )}
    </li>
  );
}

/**
 * The in-app changelog, opened from the version chip in the header or from a
 * release banner. Reads the CHANGELOG.md bundled into this build (see
 * lib/appChangelog.ts). Entries are English only by design; only the chrome
 * is translated. A `modal-panel`, so Win95 gives it a title bar for free.
 */
export function ChangelogDialog({ releases, focusVersion, onClose }: ChangelogDialogProps) {
  const { t } = useTranslation();
  const focusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // jsdom has no scrollIntoView.
    focusRef.current?.scrollIntoView?.({ block: "start" });
  }, [focusVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="changelog-backdrop"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        className="modal-panel bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 id="changelog-title" className="text-xl font-bold">
            {t("changelog.title")}
          </h2>
          <button type="button" className="btn-secondary" onClick={onClose} aria-label={t("changelog.close")}>
            ✕
          </button>
        </div>

        {releases.length === 0 ? (
          <p className="text-text-light">{t("changelog.empty")}</p>
        ) : (
          releases.map((release) => {
            const focused = release.version === focusVersion;
            return (
              <section
                key={release.version}
                ref={focused ? focusRef : undefined}
                className={`changelog-release${focused ? " changelog-release--focus" : ""}`}
              >
                <h3 className="changelog-version">
                  v{release.version}
                  {release.date && <span className="changelog-date">{formatDate(release.date)}</span>}
                </h3>
                {release.sections.map((section, i) => (
                  <div key={i}>
                    {(section.kind !== "other" || section.title) && (
                      <h4 className="changelog-kind">
                        {section.kind === "other" ? section.title : t(`changelog.kinds.${section.kind}`)}
                      </h4>
                    )}
                    <ul className="changelog-entries">
                      {section.entries.map((entry, j) => (
                        <Entry key={j} entry={entry} />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run to see it pass**

Run: `pnpm vitest run src/components/ChangelogDialog.test.tsx`
Expected: 7 passed. (The first test's expected text concatenates the version and date because the date is a child span; if the date's `formatDate` output differs by time zone in CI, it won't: the date is parsed as local midnight and formatted locally.)

- [ ] **Step 7: Wire the chip and dialog into App**

In `frontend/src/App.tsx`:

Imports (with the other component imports; add `useCallback` to the React import on line 1):

```tsx
import { ChangelogDialog } from "./components/ChangelogDialog";
import { APP_VERSION, RELEASES } from "./lib/appChangelog";
```

State, next to `const [authOpen, setAuthOpen] = useState(false);`:

```tsx
  // null = closed. `focus` is the release to scroll to (a release banner
  // passes its version); the header chip opens at the top.
  const [changelog, setChangelog] = useState<{ focus: string | null } | null>(null);
  const openChangelog = useCallback(
    (version: string | null) => setChangelog({ focus: version }),
    [],
  );
```

Header: replace `<h1 className="text-[1.875rem] font-bold">{t("app.title")}</h1>` with:

```tsx
        <div className="flex items-baseline gap-2">
          <h1 className="text-[1.875rem] font-bold">{t("app.title")}</h1>
          <button
            type="button"
            className="version-chip"
            onClick={() => openChangelog(null)}
            title={t("changelog.open")}
          >
            v{APP_VERSION}
          </button>
        </div>
```

At the end of the root element's children (next to the other modals, e.g. after the `PlayerModal`/auth dialog rendering):

```tsx
      {changelog && (
        <ChangelogDialog
          releases={RELEASES}
          focusVersion={changelog.focus}
          onClose={() => setChangelog(null)}
        />
      )}
```

- [ ] **Step 8: Styles**

Append to `frontend/src/App.css` (outside any media query; put the Win95 rule beside the other `[data-theme="win95"]` rules):

```css
/* The app version next to the title; opens the changelog. Deliberately quiet -
   it is there for whoever wonders, not to compete with the title. */
.version-chip {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-light);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  cursor: pointer;
}
.version-chip:hover,
.version-chip:focus-visible {
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.changelog-release {
  padding: 0.75rem 0.5rem;
  border-top: 1px solid var(--color-border);
}
.changelog-release:first-of-type {
  border-top: none;
}
.changelog-release--focus {
  background: var(--color-bg-light);
  border-radius: 0.5rem;
}
.changelog-version {
  font-size: 1.1rem;
  font-weight: 700;
}
.changelog-date {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-light);
}
.changelog-kind {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-light);
}
.changelog-entries {
  list-style: disc;
  padding-left: 1.25rem;
  margin-top: 0.25rem;
}
.changelog-entry {
  margin: 0.25rem 0;
}
.changelog-entry code {
  font-size: 0.85em;
  padding: 0 0.25em;
  border-radius: 0.25rem;
  background: var(--color-bg-light);
}
.changelog-pr {
  font-size: 0.8rem;
  color: var(--color-primary);
}
.changelog-details summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--color-text-light);
}

[data-theme="win95"] .version-chip,
[data-theme="win95"] .changelog-release--focus {
  border-radius: 0;
}
```

- [ ] **Step 9: Full frontend check**

Run (from `frontend/`): `pnpm lint && pnpm test && pnpm build`
Expected: lint clean, all tests pass, build succeeds (proves `?raw` + `define` resolve in the real build).

- [ ] **Step 10: Commit**

```bash
git add frontend/vite.config.ts frontend/src/vite-env.d.ts frontend/src/lib/appChangelog.ts frontend/src/components/ChangelogDialog.tsx frontend/src/components/ChangelogDialog.test.tsx frontend/src/App.tsx frontend/src/App.css frontend/src/locales
git commit -m "ELO-9: Version chip and changelog dialog"
```

---

### Task 4: Release banner - schema, admin Announce

**Files:**
- Create: `supabase/migrations/20260926_release_banners.sql`, `frontend/src/components/BannerAdmin.test.tsx`
- Modify: `frontend/src/lib/banners.ts` (type at line 44, add helpers), `frontend/src/lib/banners.test.ts`, `frontend/src/lib/supabase.ts` (banner section ~line 476), `frontend/src/components/BannerAdmin.tsx`, `frontend/src/App.tsx` (BannerAdmin at ~line 516), `frontend/src/locales/{en,de}.json`

**Interfaces:**
- Consumes: `APP_VERSION` (Task 3), passed in by App.
- Produces: `Banner.release_version?: string | null`; `RELEASE_BANNER_DAYS = 14`; `releaseBannerMessage(version: string): string`; `releaseBannerWindow(nowMs: number): { starts_at: string; ends_at: string }`; `isReleaseAnnounced(banners: Banner[], version: string): boolean`; `announceRelease(version: string, nowMs?: number): Promise<void>`; `BannerAdmin` prop `appVersion: string`.

- [ ] **Step 1: Migration**

`supabase/migrations/20260926_release_banners.sql`:

```sql
-- Release announcements: a banner that opens the in-app changelog when clicked.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- release_version is set on the banner an admin creates with "Announce" in the
-- Banner admin, and is what makes it a link. Its text is English only and
-- stored literally (unlike the season banner's NULL-means-translated-default),
-- so banner_message_present needs no change, and neither does RLS: admins
-- already insert and update banners, and everyone who may read a banner may
-- read this column.

ALTER TABLE banners ADD COLUMN IF NOT EXISTS release_version TEXT;

-- One announcement per release.
CREATE UNIQUE INDEX IF NOT EXISTS idx_banners_one_per_release
  ON banners (release_version) WHERE release_version IS NOT NULL;
```

- [ ] **Step 2: Failing tests for the pure helpers**

Append to `frontend/src/lib/banners.test.ts` (add the new names to its existing import from `./banners`; reuse the file's existing `Banner` fixture helper if it has one, otherwise the literal below):

```ts
describe("release banners", () => {
  const row = (release_version: string | null | undefined): Banner => ({
    id: "r",
    message: "x",
    season_id: null,
    starts_at: null,
    ends_at: null,
    is_active: true,
    audience: "everyone",
    sort_order: 0,
    created_by: null,
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    release_version,
  });

  it("writes the English announcement for a version", () => {
    expect(releaseBannerMessage("1.4.0")).toBe("🎉 TöggElo v1.4.0 is out - see what's new");
  });

  it("runs from now for RELEASE_BANNER_DAYS", () => {
    const now = Date.parse("2026-09-26T10:00:00Z");
    expect(releaseBannerWindow(now)).toEqual({
      starts_at: "2026-09-26T10:00:00.000Z",
      ends_at: "2026-10-10T10:00:00.000Z",
    });
    expect(RELEASE_BANNER_DAYS).toBe(14);
  });

  it("knows whether a version already has its banner", () => {
    expect(isReleaseAnnounced([row("1.4.0")], "1.4.0")).toBe(true);
    expect(isReleaseAnnounced([row("1.3.0")], "1.4.0")).toBe(false);
    // Rows fetched before the migration have no column at all.
    expect(isReleaseAnnounced([row(undefined), row(null)], "1.4.0")).toBe(false);
  });
});
```

Run: `pnpm vitest run src/lib/banners.test.ts`
Expected: FAIL, the new exports don't exist.

- [ ] **Step 3: Implement the helpers**

In `frontend/src/lib/banners.ts`, add to the `Banner` type after `season_id`:

```ts
  /**
   * Set only on a release announcement ("Announce" in the banner admin); makes
   * it open the changelog. Optional because the frontend can ship before the
   * migration adds the column.
   */
  release_version?: string | null;
```

And add near `SEASON_BANNER_DAYS`:

```ts
/**
 * How long "Announce" runs a release banner. Unlike SEASON_BANNER_DAYS this
 * one is authoritative: the admin UI writes the window itself.
 */
export const RELEASE_BANNER_DAYS = 14;

/**
 * A release banner's text. English only by design and stored literally, so an
 * admin can reword it; the link comes from `release_version`, not the text.
 */
export function releaseBannerMessage(version: string): string {
  return `🎉 TöggElo v${version} is out - see what's new`;
}

export function releaseBannerWindow(nowMs: number): {
  starts_at: string;
  ends_at: string;
} {
  return {
    starts_at: new Date(nowMs).toISOString(),
    ends_at: new Date(nowMs + RELEASE_BANNER_DAYS * 86_400_000).toISOString(),
  };
}

export function isReleaseAnnounced(banners: Banner[], version: string): boolean {
  return banners.some((b) => b.release_version === version);
}
```

Run: `pnpm vitest run src/lib/banners.test.ts`
Expected: PASS.

- [ ] **Step 4: `announceRelease` in supabase.ts**

In `frontend/src/lib/supabase.ts`, add a value import at the top with the other imports:

```ts
import { releaseBannerMessage, releaseBannerWindow } from "./banners";
```

and after `deleteBanner`:

```ts
/**
 * Announce a release: an ordinary banner plus the version that makes it open
 * the changelog. The unique index on release_version rejects a second one.
 */
export async function announceRelease(
  version: string,
  nowMs = Date.now(),
): Promise<void> {
  markLocalMutation();
  const { error } = await supabase.from("banners").insert({
    message: releaseBannerMessage(version),
    release_version: version,
    ...releaseBannerWindow(nowMs),
    is_active: true,
    audience: "everyone",
  });
  if (error) throw error;
}
```

- [ ] **Step 5: i18n keys**

Inside `"bannerAdmin"` in `en.json`:

```json
"currentVersion": "Current version: v{{version}}",
"announce": "Announce",
"announcing": "Announcing…",
"announced": "Already announced",
"announceHint": "Creates a banner for everyone, running {{days}} days, that opens the changelog when clicked. Edit it below like any other.",
"announceError": "Failed to announce the release.",
"releaseBadge": "Release",
"releaseBannerTitle": "Announces v{{version}} - clicking it opens the changelog",
```

and in `de.json`:

```json
"currentVersion": "Aktuelle Version: v{{version}}",
"announce": "Ankündigen",
"announcing": "Wird angekündigt…",
"announced": "Bereits angekündigt",
"announceHint": "Erstellt ein Banner für alle, {{days}} Tage lang, das beim Anklicken die Neuigkeiten öffnet. Unten wie jedes andere bearbeitbar.",
"announceError": "Das Release konnte nicht angekündigt werden.",
"releaseBadge": "Release",
"releaseBannerTitle": "Kündigt v{{version}} an - ein Klick öffnet die Neuigkeiten",
```

- [ ] **Step 6: Failing BannerAdmin tests**

`frontend/src/components/BannerAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Banner } from "../lib/banners";

const announceRelease = vi.fn();
vi.mock("../lib/supabase", () => ({
  announceRelease: (...args: unknown[]) => announceRelease(...args),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  deleteBanner: vi.fn(),
  reorderBanners: vi.fn(),
}));

const { BannerAdmin } = await import("./BannerAdmin");

const releaseRow: Banner = {
  id: "rel",
  message: "🎉 TöggElo v1.4.0 is out - see what's new",
  season_id: null,
  release_version: "1.4.0",
  starts_at: null,
  ends_at: null,
  is_active: true,
  audience: "everyone",
  sort_order: 0,
  created_by: null,
  created_at: "2026-09-26T00:00:00Z",
  updated_at: "2026-09-26T00:00:00Z",
};

function setup(banners: Banner[] = []) {
  const onChanged = vi.fn();
  const view = render(
    <BannerAdmin banners={banners} seasons={[]} onChanged={onChanged} appVersion="1.4.0" />,
  );
  return { onChanged, ...view };
}

describe("BannerAdmin release announcements", () => {
  beforeEach(() => announceRelease.mockReset());

  it("announces the running version", async () => {
    announceRelease.mockResolvedValue(undefined);
    const { onChanged } = setup();
    expect(screen.getByText("Current version: v1.4.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Announce" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(announceRelease).toHaveBeenCalledWith("1.4.0");
  });

  it("won't announce the same version twice", () => {
    setup([releaseRow]);
    expect(screen.getByRole("button", { name: "Already announced" })).toBeDisabled();
  });

  it("offers it again once that banner is deleted", () => {
    const { rerender } = setup([releaseRow]);
    rerender(
      <BannerAdmin banners={[]} seasons={[]} onChanged={vi.fn()} appVersion="1.4.0" />,
    );
    expect(screen.getByRole("button", { name: "Announce" })).toBeEnabled();
  });

  it("shows why an announcement failed", async () => {
    announceRelease.mockRejectedValue(new Error("duplicate key value"));
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Announce" }));
    expect(await screen.findByText("duplicate key value")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("marks release banners in the list", () => {
    setup([releaseRow]);
    expect(screen.getByText("Release")).toHaveAttribute(
      "title",
      "Announces v1.4.0 - clicking it opens the changelog",
    );
  });
});
```

Run: `pnpm vitest run src/components/BannerAdmin.test.tsx`
Expected: FAIL (no "Current version" text / no Announce button). If the file fails earlier on a missing mock export, add that name to the `vi.mock` factory as another `vi.fn()` - BannerAdmin's import list is at the top of `BannerAdmin.tsx`.

- [ ] **Step 7: Implement the Announce control and badge**

In `frontend/src/components/BannerAdmin.tsx`:

Add `announceRelease` to the import from `"../lib/supabase"`, and `RELEASE_BANNER_DAYS`, `isReleaseAnnounced` to the import from `"../lib/banners"`.

Props:

```tsx
interface BannerAdminProps {
  banners: Banner[];
  seasons: Season[];
  onChanged: () => void;
  /** The version this build is; what "Announce" announces. */
  appVersion: string;
}
```

Destructure it: `export function BannerAdmin({ banners, seasons, onChanged, appVersion }: BannerAdminProps) {`, add state `const [announcing, setAnnouncing] = useState(false);` beside `saving`, and a handler beside `handleDelete`:

```tsx
  const announced = isReleaseAnnounced(banners, appVersion);

  const handleAnnounce = async () => {
    setAnnouncing(true);
    setError(null);
    try {
      await announceRelease(appVersion);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bannerAdmin.announceError"));
    } finally {
      setAnnouncing(false);
    }
  };
```

Render, directly after the hint `<p>` under `<h2>{t("bannerAdmin.title")}</h2>`:

```tsx
      <div className="flex flex-wrap items-center gap-3 mb-4 text-[0.85rem]">
        <span>{t("bannerAdmin.currentVersion", { version: appVersion })}</span>
        <button
          type="button"
          className="btn-small"
          onClick={handleAnnounce}
          disabled={announced || announcing}
          title={t("bannerAdmin.announceHint", { days: RELEASE_BANNER_DAYS })}
        >
          {announced
            ? t("bannerAdmin.announced")
            : announcing
              ? t("bannerAdmin.announcing")
              : t("bannerAdmin.announce")}
        </button>
      </div>
```

Make sure the existing error display (wherever `error` is rendered in this component) is outside the form-only branch so an announce error shows; if it's inside the form, it still renders because the form is always shown - verify with the failing test.

Badge: next to the existing season badge (the `<span>` rendering `t("bannerAdmin.seasonBadge")`, ~line 515), add:

```tsx
                  {banner.release_version != null && (
                    <span
                      className="text-[0.7rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-bg-light text-text-light border-border"
                      title={t("bannerAdmin.releaseBannerTitle", { version: banner.release_version })}
                    >
                      {t("bannerAdmin.releaseBadge")}
                    </span>
                  )}
```

In `App.tsx`, pass the version:

```tsx
            <BannerAdmin
              banners={banners}
              seasons={seasons}
              onChanged={refresh}
              appVersion={APP_VERSION}
            />
```

- [ ] **Step 8: Run to see it pass**

Run: `pnpm vitest run src/components/BannerAdmin.test.tsx src/lib/banners.test.ts`
Expected: all pass.

- [ ] **Step 9: Full check and commit**

Run: `pnpm lint && pnpm test`
Expected: clean.

```bash
git add supabase/migrations/20260926_release_banners.sql frontend/src/lib/banners.ts frontend/src/lib/banners.test.ts frontend/src/lib/supabase.ts frontend/src/components/BannerAdmin.tsx frontend/src/components/BannerAdmin.test.tsx frontend/src/App.tsx frontend/src/locales
git commit -m "ELO-9: Announce a release as a banner"
```

---

### Task 5: Clickable release link in the marquee

**Files:**
- Modify: `frontend/src/lib/turntable.ts`, `frontend/src/lib/turntable.test.ts`, `frontend/src/hooks/useTurntable.ts`, `frontend/src/components/MessageBanner.tsx`, `frontend/src/components/MessageBanner.test.tsx`, `frontend/src/App.css`, `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `Banner.release_version` (Task 4); `openChangelog(version)` (Task 3).
- Produces: `isTap(travel: number): boolean`; `useTurntable(trackRef, copies, durationSeconds, onTap?: (target: EventTarget | null) => void)` now also returns `onClickCapture`; `MessageBanner` prop `onOpenChangelog?: (version: string) => void`.

- [ ] **Step 1: Failing test for `isTap`**

Append to `frontend/src/lib/turntable.test.ts` (add `isTap` to its import):

```ts
describe("isTap", () => {
  it("counts a press that barely moved as a tap", () => {
    expect(isTap(0)).toBe(true);
    expect(isTap(4)).toBe(true);
    expect(isTap(-4)).toBe(true);
  });

  it("counts anything further as a scratch", () => {
    expect(isTap(5)).toBe(false);
    expect(isTap(-12)).toBe(false);
  });
});
```

Run: `pnpm vitest run src/lib/turntable.test.ts` → FAIL (`isTap` not exported).

- [ ] **Step 2: Implement `isTap`**

In `frontend/src/lib/turntable.ts`, beside the other constants:

```ts
/** Travel below this is a tap, not a scratch: no hand presses perfectly still. */
const TAP_SLOP_PX = 5;
```

and beside `isFlick`:

```ts
export function isTap(travel: number): boolean {
  return Math.abs(travel) < TAP_SLOP_PX;
}
```

Run: `pnpm vitest run src/lib/turntable.test.ts` → PASS.

- [ ] **Step 3: Failing MessageBanner tests**

In `frontend/src/components/MessageBanner.test.tsx`, add a fixture after `seasonBanner`:

```tsx
const releaseBanner = (o: Partial<Banner> = {}): Banner =>
  banner({
    id: "release-banner",
    message: "🎉 TöggElo v1.4.0 is out - see what's new",
    release_version: "1.4.0",
    ...o,
  });
```

Inside `describe("MessageBanner scratching", ...)` (it has the `clock`/`offsetWidth` mocks these need), add:

```tsx
  const links = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-release-version]"));

  it("opens the changelog on a tap on any copy of the release link", () => {
    const onOpen = vi.fn();
    const { container } = setup({ banners: [releaseBanner()], onOpenChangelog: onOpen });
    expect(links(container)).toHaveLength(3);
    // Mostly a hidden copy is the one on screen.
    const link = links(container)[1];
    fireEvent.pointerDown(link, { pointerId: 1, button: 0, clientX: 500 });
    clock = 120;
    fireEvent.pointerUp(link, { pointerId: 1, clientX: 502 });
    // The browser's own click that follows the tap must not open it twice.
    fireEvent.click(link, { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("1.4.0");
    expect(bar()).not.toHaveAttribute("data-scratching");
  });

  it("scratches instead when a drag starts on the link", () => {
    const onOpen = vi.fn();
    const { container } = setup({ banners: [releaseBanner()], onOpenChangelog: onOpen });
    const link = links(container)[0];
    fireEvent.pointerDown(link, { pointerId: 1, button: 0, clientX: 500 });
    clock = 16;
    fireEvent.pointerMove(link, { pointerId: 1, clientX: 400 });
    clock = 500;
    fireEvent.pointerUp(link, { pointerId: 1, clientX: 400 });
    fireEvent.click(link, { detail: 1 });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens nothing on a tap elsewhere on the bar", () => {
    const onOpen = vi.fn();
    setup({ banners: [releaseBanner()], onOpenChangelog: onOpen });
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerUp(bar(), { pointerId: 1, clientX: 500 });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is reachable by keyboard in the first copy only", () => {
    const onOpen = vi.fn();
    const { container } = setup({ banners: [releaseBanner()], onOpenChangelog: onOpen });
    // Hidden copies are aria-hidden, so only the first is a button to AT.
    const button = screen.getByRole("button", { name: /v1\.4\.0/ });
    fireEvent.click(button); // keyboard activation: detail 0
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(links(container).slice(1).every((l) => l.tabIndex === -1)).toBe(true);
  });

  it("is a plain button under reduced motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    try {
      const onOpen = vi.fn();
      const { container } = setup({ banners: [releaseBanner()], onOpenChangelog: onOpen });
      const link = links(container)[0];
      fireEvent.pointerDown(link, { pointerId: 1, button: 0, clientX: 500 });
      fireEvent.pointerUp(link, { pointerId: 1, clientX: 500 });
      fireEvent.click(link, { detail: 1 });
      expect(onOpen).toHaveBeenCalledTimes(1);
    } finally {
      // @ts-expect-error jsdom has no matchMedia of its own to restore.
      delete window.matchMedia;
    }
  });

  it("renders ordinary banners, and release banners without a handler, as text", () => {
    const { container } = setup({ banners: [banner(), releaseBanner()] });
    expect(links(container)).toHaveLength(0);
    expect(marqueeText()).toContain("v1.4.0");
  });
```

Run: `pnpm vitest run src/components/MessageBanner.test.tsx` → the new tests FAIL (no `[data-release-version]` elements); existing ones still pass.

- [ ] **Step 4: Teach `useTurntable` taps**

In `frontend/src/hooks/useTurntable.ts`:

Imports: `import type { MouseEvent, PointerEvent, RefObject } from "react";` and add `isTap` to the `../lib/turntable` import.

Add `target` to the held grip:

```ts
  | {
      kind: "held";
      pointerId: number;
      /** What was pressed - a tap is handed back to the caller with it. */
      target: EventTarget | null;
      startX: number;
      // ...rest unchanged
```

Signature and refs:

```ts
export function useTurntable(
  trackRef: RefObject<HTMLElement | null>,
  copies: number,
  durationSeconds: number,
  /**
   * Called with the pressed element when a grab turns out to be a tap. The
   * browser's own click is swallowed while the turntable is live (see
   * onClickCapture), so this is the one way a pointer click reaches the strip.
   */
  onTap?: (target: EventTarget | null) => void,
) {
  const grip = useRef<Grip>({ kind: "idle" });
  const bar = useRef<HTMLElement | null>(null);
  const frame = useRef(0);
  const duration = useRef(durationSeconds);
  const tap = useRef(onTap);
  /** A grab happened, so the click the browser sends after it is ours. */
  const swallowClick = useRef(false);

  useEffect(() => {
    tap.current = onTap;
  }, [onTap]);
```

In `release`, after `const offset = ...` and before computing `velocity`:

```ts
    // Barely moved: a click, not a scratch. Only on a real release - a
    // cancelled pointer was taken by the browser, not pressed.
    if (mayCoast && isTap(current.travel)) {
      handBack(offset);
      tap.current?.(current.target);
      return;
    }
```

In `onPointerDown`, just before `bar.current = e.currentTarget;`:

```ts
      swallowClick.current = true;
```

and add `target: e.target,` to the `grip.current = { kind: "held", ... }` object.

Add to the returned object:

```ts
    /**
     * Swallow the pointer click that follows a grab: a tap was already handed
     * to onTap, and a scratch is not a click. Keyboard activation (detail 0)
     * always goes through, and under reduced motion no grab starts, so the
     * browser's click reaches the element as normal.
     */
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      if (e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
    },
```

- [ ] **Step 5: Render the release link**

In `frontend/src/components/MessageBanner.tsx`:

Import `useCallback`. Props:

```tsx
interface MessageBannerProps {
  banners: Banner[];
  seasons: Season[];
  signedIn: boolean;
  /** Makes a release banner a link to the changelog at its version. */
  onOpenChangelog?: (version: string) => void;
}
```

Replace the `messages` memo with items that keep the version:

```tsx
  const items = useMemo(
    () =>
      visibleBanners(banners, now, signedIn)
        .map((banner) => ({
          id: banner.id,
          text: bannerDisplayText(banner, seasons, t),
          releaseVersion: banner.release_version ?? null,
        }))
        // A season banner pointing at a season we don't have resolves to "";
        // drop it rather than render an empty slot between separators.
        .filter((item) => item.text),
    [banners, seasons, signedIn, now, t],
  );
```

Update the duration calculation to use `items.map((i) => i.text).join("")` and `items.length`, and the early return to `if (items.length === 0) return null;`.

Tap handler (before `useTurntable`), and pass it:

```tsx
  // A tap anywhere on a release link - in any copy - opens the changelog.
  const handleTap = useCallback(
    (target: EventTarget | null) => {
      const link =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-release-version]")
          : null;
      const version = link?.dataset.releaseVersion;
      if (version) onOpenChangelog?.(version);
    },
    [onOpenChangelog],
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const turntable = useTurntable(trackRef, MARQUEE_COPIES, durationSeconds, handleTap);
```

In the copy loop, render items:

```tsx
              {items.map((item, m) => (
                <span key={item.id} className="banner-marquee-item">
                  {m > 0 && (
                    <span className="banner-marquee-sep" aria-hidden="true">
                      {SEPARATOR_BULLET}
                    </span>
                  )}
                  {item.releaseVersion && onOpenChangelog ? (
                    <button
                      type="button"
                      className="banner-link"
                      data-release-version={item.releaseVersion}
                      // Only the first copy is exposed to AT; the others stay
                      // clickable but out of the tab order.
                      tabIndex={i > 0 ? -1 : undefined}
                      onClick={() => onOpenChangelog(item.releaseVersion!)}
                    >
                      {item.text}
                    </button>
                  ) : (
                    item.text
                  )}
                </span>
              ))}
```

Update the component's doc comment's last paragraph to: "The strip can also be grabbed and scratched like a record - see `useTurntable`. A release banner's text is a link to the changelog; a tap on it (as opposed to a scratch) opens it."

- [ ] **Step 6: Styles**

In `frontend/src/App.css`, change `.banner-marquee` to span the bar's full height, so the link's hit area isn't clipped by its `overflow: hidden`:

```css
.banner-marquee {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  /* Fill the bar's height (its padding is 0.5rem): overflow hides - and stops
     hit-testing - anything outside this box, which would clip .banner-link's
     enlarged target to the line of text. */
  margin: -0.5rem 0;
  padding: 0.5rem 0;
}
```

After `.banner-marquee-sep`:

```css
/* The one clickable thing in the strip: a release banner opens the changelog.
   Underlined so it reads as a link. The padding is a bigger target for moving
   text; the equal negative margin cancels it, so the strip - and the copy width
   the seamless loop is paced on - doesn't change. */
.banner-link {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0.5rem;
  margin: -0.5rem;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}
.banner-link:hover,
.banner-link:focus-visible {
  text-decoration-thickness: 2px;
}
.banner-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -4px;
  border-radius: 4px;
}
```

Inside the existing `@media (prefers-reduced-motion: no-preference)` block, after `.message-banner[data-scratching]`:

```css
  .message-banner[data-scratching] .banner-link {
    cursor: grabbing;
  }
```

Beside `[data-theme="win95"] .message-banner`:

```css
[data-theme="win95"] .banner-link {
  text-decoration-style: dotted;
}
[data-theme="win95"] .banner-link:focus-visible {
  border-radius: 0;
}
```

- [ ] **Step 7: Wire in App**

In `App.tsx`:

```tsx
      <MessageBanner
        banners={banners}
        seasons={seasons}
        signedIn={Boolean(user)}
        onOpenChangelog={openChangelog}
      />
```

- [ ] **Step 8: Run to see it pass**

Run: `pnpm vitest run src/components/MessageBanner.test.tsx src/lib/turntable.test.ts`
Expected: all pass, the original scratching tests included.

- [ ] **Step 9: Full check, manual check, commit**

Run: `pnpm lint && pnpm test && pnpm build` → clean.

Manual (`pnpm dev`, admin on staging with the migration applied): Announce, then in light, dark and Win95: the link is underlined; a quick click opens the changelog; a drag from the link scratches without opening it; hovering the link shows the pointer, dragging shows grabbing; the loop stays seamless (no jump at the seam); Tab reaches the link once.

```bash
git add frontend/src/lib/turntable.ts frontend/src/lib/turntable.test.ts frontend/src/hooks/useTurntable.ts frontend/src/components/MessageBanner.tsx frontend/src/components/MessageBanner.test.tsx frontend/src/App.css frontend/src/App.tsx
git commit -m "ELO-9: Release banner opens the changelog on a tap"
```

---

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: CLAUDE.md**

Under **Commands**, add:

````markdown
### Releases (run from repo root)
```bash
pnpm changeset   # add a changeset to your PR (see .changeset/README.md)
```
````

In **Frontend Structure**, add bullets (keep the file's style):

- `frontend/src/lib/changelog.ts` - pure parser for the changesets `CHANGELOG.md` (`parseChangelog` → releases → sections by kind → entries with summary, developer `details`, PR link, author) plus `inlineTokens` for the only inline markdown rendered (`code`, http(s) links - never other schemes). Accepts bare `- summary` lines and dated headings so hand-written history fits; never throws. No DB calls
- `frontend/src/lib/appChangelog.ts` - `APP_VERSION` (from `frontend/package.json` via Vite `define`, declared in `vite-env.d.ts`) and `RELEASES` (the bundled `frontend/CHANGELOG.md` via `?raw`). Compiled in, so the dialog needs no fetch and always matches the deployment
- `frontend/src/components/ChangelogDialog.tsx` - the "What's new" `modal-panel`, opened from the `v1.2.3` chip beside the header title or from a release banner (which focuses its version). Entries English only; chrome translated

Extend the `MessageBanner.tsx` bullet with: "**A release banner's text is a `<button>`** (`data-release-version`) that opens the changelog. The turntable grabs on every press, so `useTurntable` tells them apart: a release with under `TAP_SLOP_PX` of travel (`isTap`) is handed to `onTap` with the pressed element, and `onClickCapture` swallows the browser's own click after any grab - otherwise a tap would open twice, and a scratch would open once. Keyboard clicks (`detail === 0`) and reduced motion (no grab) go through untouched. `.banner-marquee` spans the bar's full height so the link's padded hit area isn't clipped by its `overflow: hidden`."

Extend the `BannerAdmin.tsx` bullet with: "The **Announce** control creates the release banner for the running build (`appVersion` prop) via `announceRelease`; disabled once a row with that `release_version` exists."

In **Database Schema**, extend `banners` with: "`release_version` on a release announcement (unique; English text stored literally, so no NULL-message case)."

Add a new section after **CI**:

```markdown
### Releases
Versioned with changesets. The versioned package is `toegg-elo-frontend` (private); its version is the app version shown in the header. Each user-visible PR adds `pnpm changeset` - first line for players, further lines for developers (see `.changeset/README.md`); changeset-bot comments when one is missing. `.github/workflows/release.yml` keeps a "Release: version packages" PR open; merging it bumps the version, writes `frontend/CHANGELOG.md` (the `version-packages` root script also dates the newest heading via `frontend/scripts/stamp-changelog-date.mjs`, since changesets writes the heading itself) and tags `toegg-elo-frontend@x.y.z` with a GitHub Release. Vercel deploys every merge, so a feature is live before its Version PR is merged - merge that right after if you want it announced. Then Admin → Message Banner → Announce.
```

- [ ] **Step 2: README.md**

In the **Deployment** section, after the production steps, add:

```markdown
### Releases

1. Every PR with a user-visible change includes a changeset: `pnpm changeset` (see `.changeset/README.md`).
2. After merging, the Release workflow opens/updates the **"Release: version packages"** PR.
3. Merge it: the version and `frontend/CHANGELOG.md` update, Vercel deploys, and the release is tagged on GitHub.
4. Optionally announce it: Admin → Message Banner → **Announce**.

One-time setup: install [changeset-bot](https://github.com/apps/changeset-bot) on the repo, and enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests* (the Release workflow needs it to open the Version PR).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "ELO-9: Document releases and the changelog"
```

---

## After merge (manual, by the maintainer)

- Install changeset-bot; enable "Allow GitHub Actions to create and approve pull requests".
- Apply `supabase/migrations/20260926_release_banners.sql` on staging, then prod (SQL editor).
- Merge the first "Release: version packages" PR; confirm the tag `toegg-elo-frontend@1.1.0` and a GitHub Release appear. If the tag was created but not pushed, add a `git push --follow-tags` step after the action in `release.yml`.
- Follow-up: seed `frontend/CHANGELOG.md` with history from past PRs (separate task).
