---
"toegg-elo-frontend": minor
---

Claim your player: open your player and press "This is me" to link your account - you get the That's Me! 🪪 achievement, your row is highlighted, and only you (or an admin) can rename your player.
Adds `player_accounts` with the `claim_player` / `admin_link_player` / `unlink_player` RPCs (migration `20260927_player_accounts.sql`, rule checks in `supabase/scripts/player-accounts-checks.sql`) and a Player column in Admin → User Management. That's Me! counts toward the meta-achievements, and link changes recompute achievements. Name protection is UI-only until #118. `calculate-elo` must be redeployed (shared achievements changed).
