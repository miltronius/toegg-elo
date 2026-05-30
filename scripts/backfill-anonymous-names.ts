// One-off backfill: assign an anonymous (musician) name to every existing player
// that doesn't have one yet. Reuses the canonical generator in the frontend so the
// musician list lives in exactly one place.
//
// Run (requires the service-role key — it bypasses RLS and can read/write real names):
//
//   SUPABASE_URL="https://<project>.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
//   deno run --allow-env --allow-net scripts/backfill-anonymous-names.ts
//
// Idempotent: only players with a NULL/empty anonymous_name are updated.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAnonymousName } from "../frontend/src/lib/anonymousNames.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !serviceKey) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.",
  );
  Deno.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: players, error } = await supabase
  .from("players")
  .select("id, name, anonymous_name");

if (error) {
  console.error("Failed to read players:", error.message);
  Deno.exit(1);
}

// Seed the "taken" set with names already assigned so we don't create duplicates.
const taken: string[] = (players ?? [])
  .map((p) => p.anonymous_name)
  .filter((n): n is string => !!n);

let updated = 0;
for (const player of players ?? []) {
  if (player.anonymous_name) continue;

  const anon = generateAnonymousName(player.name, taken);
  taken.push(anon);

  const { error: updateError } = await supabase
    .from("players")
    .update({ anonymous_name: anon })
    .eq("id", player.id);

  if (updateError) {
    console.error(`Failed to update ${player.name}:`, updateError.message);
    continue;
  }

  console.log(`${player.name} -> ${anon}`);
  updated++;
}

console.log(`\nDone. Updated ${updated} player(s).`);
