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

const bare = (summary: string) => ({
  summary,
  details: null,
  prNumber: null,
  prUrl: null,
  author: null,
});

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
    expect(releases[0].sections[0].entries[0]).toMatchObject({
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
        entries: [bare("Relationship graph"), bare("Message banners")],
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

  it("treats whitespace-only lines inside details as paragraph breaks", () => {
    // What changesets actually writes between a summary's paragraphs.
    const [release] = parseChangelog("## 1.1.0\n\n- Summary\n  \n  More detail.\n");
    expect(release.sections[0].entries[0]).toMatchObject({
      summary: "Summary",
      details: "More detail.",
    });
  });

  it("keeps a stray paragraph as plain text instead of throwing", () => {
    const [release] = parseChangelog("## 2.0.0\n\nSomething odd here\n");
    expect(release.sections[0].entries[0].summary).toBe("Something odd here");
  });

  it("drops sections left empty", () => {
    const [release] = parseChangelog(
      "## 2.0.0\n\n### Patch Changes\n\n### Minor Changes\n\n- x\n",
    );
    expect(release.sections.map((s) => s.kind)).toEqual(["minor"]);
  });
});

describe("inlineTokens", () => {
  it("splits code and links out of text", () => {
    expect(
      inlineTokens("Use `pnpm changeset`, see [docs](https://x.dev/a) now"),
    ).toEqual([
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
