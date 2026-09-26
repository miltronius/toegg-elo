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
the release (`v1.2.3`, with a GitHub Release). Announce it from
Admin → Message Banner → Announce.
