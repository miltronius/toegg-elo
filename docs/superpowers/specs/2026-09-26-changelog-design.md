# Versioning, Changelog & Release Banner - Design

Issue: [#9 Add page for app version logs](https://github.com/miltronius/toegg-elo/issues/9)

## Goal

Give TöggELO a real version number, a changelog that writes itself from the PRs that
go in, a place in the app to read it, and a one-click way for an admin to announce a
release through the existing message banner.

**Audience:** one changelog, read by players *and* developers. Each entry's first line
is written so a player understands it; optional technical detail sits beneath it.
**Language:** changelog entries are English only. UI chrome around them (dialog title,
buttons, the default release-banner text) is translated like everything else.

## Current state

- No tags, no GitHub Releases; `frontend/package.json` has been `1.0.0` forever.
- Vercel deploys every merge to `main` to production.
- Banners already support a generated, translated default (`message = NULL` on the
  season banner) that an admin can override - the release banner reuses that pattern.

## 1. Release pipeline (changesets)

**Setup**
- Root devDependencies: `@changesets/cli`, `@changesets/changelog-github`.
  `pnpm changeset init` creates `.changeset/config.json` + README.
- The versioned package is `toegg-elo-frontend`; its `version` **is the app version**.
  The root `package.json` stays private/unversioned. The edge function is not a package;
  a release covers everything merged, `calculate-elo` changes included, which get
  changesets like anything else.
- `.changeset/config.json`: `changelog: ["@changesets/changelog-github", { "repo": "miltronius/toegg-elo" }]`,
  `baseBranch: "main"`, `access: "restricted"`, `commit: false`,
  `privatePackages: { version: true, tag: true }`.
- `frontend/package.json` gains `"private": true` (it is never published to npm).
- Starting point: stays at `1.0.0`; the first Version PR produces `1.1.0` (or whatever
  the pending changesets dictate).
- `CHANGELOG.md` lives in `frontend/` (where changesets writes it for the package).

**Per PR (convention, documented in `.changeset/README.md` and CLAUDE.md)**
- `pnpm changeset` → pick patch/minor/major → write the note.
- First line: player-readable summary. Further lines: optional technical detail.
- Purely internal PRs (CI, refactors) may have no changeset; they don't appear in the
  changelog.

**Nudge:** install the [changeset-bot](https://github.com/apps/changeset-bot) GitHub App
on the repo. It comments on each PR - a warning with a one-click "add changeset" link
when none is present, or a summary of the changesets when there are. Non-blocking.
(No husky pre-push hook: it would fire on every WIP push, before the question matters.)

**Release workflow** - new `.github/workflows/release.yml`, on push to `main`:
- `changesets/action@v1` keeps a **"Version Packages" PR** open, containing the version
  bump and the new `CHANGELOG.md` section. Merging it *is* the release.
- `version` command: `pnpm changeset version && node scripts/stamp-changelog-date.mjs`.
- `publish` command: `pnpm changeset tag` (no npm publish). With
  `privatePackages: { version: true, tag: true }` in the config and `"private": true` on
  `frontend/package.json`, it creates the git tag (`toegg-elo-frontend@1.4.0`, the
  workspace naming) only for versions not tagged yet, so it is idempotent; the action
  pushes it and creates the GitHub Release from the `New tag:` output.
- Permissions: `contents: write`, `pull-requests: write`. Uses `GITHUB_TOKEN`; no
  Supabase secrets.
- Accepted trade-off: a feature merged to `main` is live on Vercel before its Version
  PR is merged. Merge the Version PR right after a feature PR to close that gap.

**Release dates** - `scripts/stamp-changelog-date.mjs`: changesets writes the heading
`## 1.4.0` itself (the formatter only shapes entry lines), so this post-step rewrites
the *newest* undated heading to `## 1.4.0 (2026-09-26)` using today's date (UTC). It
never touches a heading that already has a date, so re-running is harmless. The date is
when the Version PR was generated/updated, which is close enough to release day.

## 2. Version chip + Changelog dialog

**Build-time data**
- `vite.config.ts` `define`: `__APP_VERSION__` from `frontend/package.json`; declared in
  a `.d.ts`.
- `CHANGELOG.md` imported via `?raw`. The changelog ships in the bundle: no fetch, no DB,
  no runtime failure mode, always exactly what was deployed.

**`frontend/src/lib/changelog.ts`** - pure, no DB calls.
- `parseChangelog(md: string): Release[]`
  ```ts
  type Release = { version: string; date: string | null; sections: Section[] };
  type Section = { kind: "major" | "minor" | "patch" | "other"; title: string; entries: Entry[] };
  type Entry = {
    summary: string;          // first line, player-readable
    details: string | null;   // remaining lines, developer detail
    prNumber: number | null;
    prUrl: string | null;
    author: string | null;
  };
  ```
- Understands the `changelog-github` line shape
  (`- [#125](url) [`abc123`](url) Thanks [@x](url)! - summary`) and also a bare
  `- summary` (for hand-written/seeded entries). Unknown headings map to `kind: "other"`;
  unparseable lines become a plain `summary` rather than throwing.
- Inline markdown in summaries is limited to what we render: `` `code` `` and links;
  everything else shows as text. No markdown library.
- Unit tests against a fixture changelog (both line shapes, dated/undated headings,
  multi-line details, empty changelog).

**UI**
- `VersionChip` - small muted `v1.4.0` button next to the `<h1>` in `App.tsx`, visible to
  everyone (logged out included). Opens the dialog.
- `ChangelogDialog` - `modal-panel` dialog (Win95 title bar for free). Releases newest
  first: version + date heading, entries grouped by section; each entry shows its
  summary, a collapsible "Details" when `details` exists, and a PR link. Scrolls.
  Optional `focusVersion` prop scrolls that release into view and highlights it.
- Open state (`changelogOpen`, `changelogFocus`) lives in `App.tsx` so both the chip and
  the banner open the same dialog.
- New i18n keys (en + de) under `changelog.*` for chrome only.

## 3. Release banner

**Migration** `supabase/migrations/2026MMDD_release_banners.sql`
- `ALTER TABLE banners ADD COLUMN IF NOT EXISTS release_version TEXT;`
- Unique partial index on `release_version WHERE release_version IS NOT NULL` - a
  release can't be announced twice.
- Replace `banner_message_present`:
  `(message IS NULL AND (season_id IS NOT NULL OR release_version IS NOT NULL)) OR (message IS NOT NULL AND char_length(btrim(message)) BETWEEN 1 AND 500)`.
- No RLS change: admins already insert/update banners; readers already read them.

**Admin (`BannerAdmin.tsx`)**
- A line above the list: "Current version: v1.4.0 · [Announce]". Disabled with
  "already announced" when a banner with that `release_version` exists (from the
  banners App already has).
- Announce inserts via a new `supabase.ts` helper: `release_version = __APP_VERSION__`,
  `message = NULL`, `audience = 'everyone'`, `starts_at = now`, `ends_at = now + 14 days`,
  `is_active = true`. Then `refresh()`.
- Afterwards it's a normal banner (edit, reschedule, retarget, delete, reorder). Its
  message field behaves like the season banner's: prefilled with the generated default,
  blank or unchanged text stores NULL, different text overrides.

**Display**
- `banners.ts`: `isGeneratedReleaseBanner(banner)` alongside `isGeneratedSeasonBanner`.
- `bannerText.ts`: `bannerDisplayText` / `storedMessage` get a release branch; default
  text is `t("banner.release", { version })`, e.g. "🎉 TöggELO v1.4.0 is out - see
  what's new". Overridden text still links to the changelog.
- `MessageBanner.tsx`: a release banner's segment renders as a button that calls
  `onOpenChangelog(version)`. In the first (accessible) copy it is focusable; in the
  `aria-hidden` copies it is `tabIndex={-1}` but still clickable.
- **Click vs scratch:** `useTurntable` currently treats every press as a grab. It gains a
  small movement threshold: a press released with less than a few px of travel (and no
  flick) is a click - it is passed through to the segment and the strip resumes as if
  never grabbed. Same rule the relationship graph uses for nodes. Pure threshold logic
  goes in `turntable.ts` with tests. Under reduced motion there is no turntable, so the
  button is just a button.

## Testing

- `changelog.test.ts` - parser, per above.
- `banners.test.ts` / `bannerText.test.ts` - release branch of visibility, display text,
  and `storedMessage` round-trip.
- `turntable.test.ts` - click-vs-drag threshold.
- Component: `ChangelogDialog` renders releases from a fixture and focuses a version;
  `BannerAdmin` announce button enabled/disabled state; `MessageBanner` release segment
  click opens the changelog.
- `stamp-changelog-date.mjs` - tested with a fixture (stamps newest undated heading only;
  idempotent).
- Manual: open a throwaway PR with a changeset → bot comments; merge → Version PR
  appears with dated `CHANGELOG.md`; migration applied on staging, announce + click
  through in all three themes.

## Documentation

CLAUDE.md gains entries for `lib/changelog.ts`, `ChangelogDialog`, the release banner
(`release_version`), and a "Releases" subsection (changeset convention, Version PR,
tagging). README's Deployment section gets the release steps.

## Out of scope / follow-ups

- **Seeding `CHANGELOG.md` from past commits/PRs** - a separate later step. The parser
  already accepts bare `- summary` lines and dated headings so hand-written history fits.
- Per-user "what's new since your last visit".
- Links on arbitrary (non-release) banners.
- Translating changelog entries.
