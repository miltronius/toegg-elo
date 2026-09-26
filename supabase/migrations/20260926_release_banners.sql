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
