-- Message banners: announcements that scroll across the top of the app.
--
-- One file for the whole feature, safe to run on a database in any state:
-- fresh (creates everything), or part-way through an earlier version of this
-- migration (fills in what is missing). Re-running it is a no-op, since these
-- are applied by hand in the Supabase SQL editor where running a file twice is
-- easy to do.
--
-- Design notes:
--
-- * The "new season has started" announcement is a row here like any other, so
--   an admin can edit, reschedule, retarget, hide or delete it. A trigger on
--   `seasons` inserts it.
-- * A row holds one language, which is why a season banner's `message` starts
--   NULL, meaning "render the built-in translated text" (see
--   frontend/src/lib/bannerText.ts). Admin text overrides it for everyone;
--   clearing the field reverts to the translation.
-- * `is_active` is a master switch *on top of* the `starts_at`/`ends_at`
--   window, not an alternative to it - hiding a banner keeps its dates.

-- ============================================================
-- 1. Table
-- ============================================================
CREATE TABLE IF NOT EXISTS banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL only on a season banner; see banner_message_present below.
  message     TEXT,

  -- Set on the banner a season start created, NULL on hand-written ones.
  season_id   UUID REFERENCES seasons(id) ON DELETE CASCADE,

  -- A NULL bound is open-ended: no starts_at = "from now", no ends_at = "until
  -- an admin stops it".
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,

  -- Who the announcement is for. 'members' covers every signed-in role (viewer
  -- included) - the split is logged-in vs the public landing view, not a
  -- permission tier.
  audience    TEXT NOT NULL DEFAULT 'everyone'
                CHECK (audience IN ('everyone', 'members')),

  -- Hand-set running order, lowest first; created_at DESC breaks ties. Every
  -- row starts at 0, so the default order is newest-first until someone drags.
  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT banner_window_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

-- Bring a banners table left by an earlier version of this migration up to the
-- shape above. All no-ops on a table just created by the statement above.
ALTER TABLE banners ADD COLUMN IF NOT EXISTS season_id UUID
  REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE banners ALTER COLUMN message DROP NOT NULL;

-- An earlier version declared the length check inline on the column, which
-- Postgres names <table>_<column>_check; it is replaced by the constraint below.
ALTER TABLE banners DROP CONSTRAINT IF EXISTS banners_message_check;

-- Only a season banner may omit its message; a hand-written banner with no text
-- would be an announcement that says nothing.
ALTER TABLE banners DROP CONSTRAINT IF EXISTS banner_message_present;
ALTER TABLE banners ADD CONSTRAINT banner_message_present CHECK (
  (message IS NULL AND season_id IS NOT NULL)
  OR (message IS NOT NULL AND char_length(btrim(message)) BETWEEN 1 AND 500)
);

-- ============================================================
-- 2. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_banners_window ON banners (is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_banners_order  ON banners (sort_order, created_at DESC);

-- At most one automatic banner per season, which is also what makes the
-- trigger's ON CONFLICT DO NOTHING idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_banners_one_per_season
  ON banners (season_id) WHERE season_id IS NOT NULL;

-- ============================================================
-- 3. Row-level security
-- ============================================================
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Readable once it is active, not yet expired, and addressed to the caller -
-- future-scheduled rows included, so a client that is already open can reveal
-- one the moment its window opens (nothing changes in the DB at that instant,
-- so no realtime event would arrive to trigger a refetch). Hidden and expired
-- rows stay admin-only, and a members-only banner is never sent to an
-- anonymous visitor in the first place, not merely hidden by the client.
DROP POLICY IF EXISTS "Anyone can read upcoming and live banners" ON banners;
CREATE POLICY "Anyone can read upcoming and live banners" ON banners
  FOR SELECT USING (
    get_my_role() = 'admin'
    OR (
      is_active
      AND (ends_at IS NULL OR ends_at > NOW())
      AND (audience = 'everyone' OR auth.uid() IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Admins can insert banners" ON banners;
CREATE POLICY "Admins can insert banners" ON banners
  FOR INSERT WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can update banners" ON banners;
CREATE POLICY "Admins can update banners" ON banners
  FOR UPDATE USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can delete banners" ON banners;
CREATE POLICY "Admins can delete banners" ON banners
  FOR DELETE USING (get_my_role() = 'admin');

-- ============================================================
-- 4. Announce every new season automatically
-- ============================================================
-- The 14-day window is kept in sync with SEASON_BANNER_DAYS in
-- frontend/src/lib/banners.ts, which only uses it to describe this behaviour in
-- the admin UI. This is the source of truth: the window lives on the row, so an
-- admin can change it per season.
CREATE OR REPLACE FUNCTION create_season_banner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.is_active THEN
    INSERT INTO banners (message, season_id, starts_at, ends_at, is_active, audience)
    VALUES (
      NULL,                                    -- render the translated default
      NEW.id,
      NEW.started_at,
      NEW.started_at + INTERVAL '14 days',
      true,
      'everyone'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_season_created ON seasons;
CREATE TRIGGER on_season_created
  AFTER INSERT ON seasons
  FOR EACH ROW EXECUTE FUNCTION create_season_banner();

-- ============================================================
-- 5. Apply a whole new order in one statement (drag and drop)
-- ============================================================
-- One RPC rather than N updates: the reorder is atomic (no intermediate state
-- where two banners share a position) and it produces a single realtime burst
-- instead of one per row.
CREATE OR REPLACE FUNCTION set_banner_order(p_ids UUID[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can reorder banners';
  END IF;

  UPDATE banners b
  SET sort_order = o.idx,
      updated_at = NOW()
  FROM unnest(p_ids) WITH ORDINALITY AS o(id, idx)
  WHERE b.id = o.id
    -- Skip rows already in place so an unchanged drag writes nothing.
    AND b.sort_order IS DISTINCT FROM o.idx;
END;
$$;

-- ============================================================
-- 6. Realtime
-- ============================================================
-- Re-adding a table to a publication is an error, so only add it when absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'banners'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.banners;
  END IF;
END $$;

-- ============================================================
-- 7. Backfill the season that is active right now
-- ============================================================
-- Only worth a row while it would still be inside its window; older seasons
-- would land pre-expired and just clutter the admin list.
INSERT INTO banners (message, season_id, starts_at, ends_at, is_active, audience)
SELECT NULL, s.id, s.started_at, s.started_at + INTERVAL '14 days', true, 'everyone'
FROM seasons s
WHERE s.is_active = true
  AND s.started_at + INTERVAL '14 days' > NOW()
ON CONFLICT DO NOTHING;
