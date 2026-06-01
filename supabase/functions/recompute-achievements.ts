// One-shot maintenance script: clear the achievement rows whose unlock logic
// changed, then recompute all achievements for every player so the corrected
// rows come back immediately (instead of waiting for the next recorded match).
//
// Run with the service-role key (bypasses RLS):
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env \
//       --import-map=supabase/functions/import_map.json \
//       supabase/functions/recompute-achievements.ts
//
// Safe to re-run: the DELETE is idempotent and recomputeAllAchievements upserts
// with ignoreDuplicates, so unchanged achievements are left untouched.

import { createClient } from "@supabase/supabase-js";
import { recomputeAllAchievements } from "./_shared/achievements.ts";

// Achievement ids whose computation changed and must be rebuilt:
//   * teams_* — a partner now only counts after pairing up at least twice
//   * carrying_hard / deadweight — gap now measured on season ELO, not all-time
const FIXED_ACHIEVEMENT_IDS = [
  "teams_1",
  "teams_3",
  "teams_10",
  "carrying_hard",
  "deadweight",
];

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.",
  );
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log(`Deleting rows for: ${FIXED_ACHIEVEMENT_IDS.join(", ")}`);
const { error: deleteError, count } = await supabase
  .from("player_achievements")
  .delete({ count: "exact" })
  .in("achievement_id", FIXED_ACHIEVEMENT_IDS);

if (deleteError) {
  console.error("Delete failed:", deleteError.message);
  Deno.exit(1);
}
console.log(`Deleted ${count ?? 0} row(s).`);

console.log("Recomputing achievements for all players...");
const { data: players, error: playersError } = await supabase
  .from("players")
  .select("*");
const { data: matches, error: matchesError } = await supabase
  .from("matches")
  .select("*");

if (playersError || matchesError || !players || !matches) {
  console.error(
    "Could not load players/matches:",
    playersError?.message ?? matchesError?.message,
  );
  Deno.exit(1);
}

await recomputeAllAchievements(supabase, players, matches);
console.log(
  `Done. Recomputed achievements across ${players.length} player(s) and ${matches.length} match(es).`,
);
