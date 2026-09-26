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
  return {
    summary: rest.slice(2).trim(),
    details: null,
    prNumber,
    prUrl,
    author,
  };
}

interface ParseState {
  release: Release | null;
  section: ChangelogSection | null;
  entry: ChangelogEntry | null;
  details: string[];
}

function closeEntry(state: ParseState) {
  if (state.entry) {
    const text = state.details.join("\n").trim();
    state.entry.details = text === "" ? null : text;
  }
  state.entry = null;
  state.details = [];
}

function addEntry(state: ParseState, entry: ChangelogEntry) {
  if (!state.release) return;
  if (!state.section) {
    state.section = { kind: "other", title: "", entries: [] };
    state.release.sections.push(state.section);
  }
  state.section.entries.push(entry);
  state.entry = entry;
}

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  const state: ParseState = {
    release: null,
    section: null,
    entry: null,
    details: [],
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      closeEntry(state);
      state.section = null;
      state.release = {
        version: heading[1],
        date: heading[2] ?? null,
        sections: [],
      };
      releases.push(state.release);
      continue;
    }
    // The "# package-name" title and anything before the first release.
    if (!state.release) continue;

    const sub = SECTION_HEADING.exec(line);
    if (sub) {
      closeEntry(state);
      state.section = {
        kind: KINDS[sub[1].toLowerCase()] ?? "other",
        title: sub[1],
        entries: [],
      };
      state.release.sections.push(state.section);
      continue;
    }

    const item = ENTRY_LINE.exec(line);
    if (item) {
      closeEntry(state);
      addEntry(state, parseEntryLine(item[1]));
      continue;
    }

    // Detail lines are indented two spaces under their entry; blank lines
    // between paragraphs belong to it too (trimmed off the ends later).
    if (state.entry && (line.trim() === "" || /^\s/.test(line))) {
      state.details.push(line.trim() === "" ? "" : line.replace(/^ {1,2}/, ""));
      continue;
    }
    if (line.trim() === "") continue;

    closeEntry(state);
    addEntry(state, plainEntry(line.trim()));
  }
  closeEntry(state);

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
    if (index > last) {
      tokens.push({ kind: "text", text: text.slice(last, index) });
    }
    if (match[1] !== undefined) tokens.push({ kind: "code", text: match[1] });
    else tokens.push({ kind: "link", text: match[2], href: match[3] });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
