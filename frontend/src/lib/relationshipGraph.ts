import { Match, Player } from "./supabase";
import { teamKey, teamKeyParts } from "./teamUtils";

/** A player who appears in at least one match in scope. */
export type RelationNode = {
  id: string;
  /** Display name as loaded (already anonymized server-side for viewers). */
  name: string;
  /** All-time ELO, unless the caller passed season-normalized players. */
  elo: number;
  /** Matches played in scope — drives node size. */
  games: number;
  wins: number;
  losses: number;
};

/**
 * Two players who played on the SAME team. The game count is symmetric, but
 * *preference* isn't: `loPicked`/`hiPicked` say whether this pairing is among
 * that player's own strongest, which is how an unrequited favourite shows up
 * (Ann's top partner is Bob, but Bob's top partner is Cid).
 */
export type FriendEdge = {
  /** Canonical `lo:hi` pair key, same scheme as team_names / teamUtils. */
  key: string;
  lo: string;
  hi: string;
  /** Matches played together. */
  games: number;
  /** Matches won together. */
  wins: number;
  losses: number;
  /** This pairing is inside lo's own top N. */
  loPicked: boolean;
  /** This pairing is inside hi's own top N. */
  hiPicked: boolean;
  /** Both ends rate each other a favourite. */
  mutual: boolean;
};

/**
 * Two players who played on OPPOSITE teams. The pair key is undirected, so the
 * record is always stored from `lo`'s point of view and `hi`'s is its complement.
 */
export type FoeEdge = {
  key: string;
  lo: string;
  hi: string;
  /** Matches played against each other. */
  games: number;
  /** Matches lo's team beat hi's team. */
  loWins: number;
  /** Always games - loWins. */
  hiWins: number;
  /** loWins / games, 0..1 — where the tug-of-war line splits. */
  loShare: number;
};

export type RelationshipGraphData = {
  nodes: RelationNode[];
  friends: FriendEdge[];
  foes: FoeEdge[];
  /** Largest `games` across friend edges, for width scaling. 0 when there are none. */
  maxFriendGames: number;
  /** Largest `games` across foe edges, for width scaling. 0 when there are none. */
  maxFoeGames: number;
  /** Largest `games` across nodes, for radius scaling. 0 when there are none. */
  maxNodeGames: number;
};

/**
 * Keeps each player's `n` strongest relationships and drops the rest.
 *
 * An absolute "at least N games" threshold cannot thin this graph: in a league
 * this size everyone eventually partners with and faces everyone, so the graph
 * is complete (all C(players,2) pairs) at any realistic match volume, and the
 * threshold that would cut it keeps moving as more matches are recorded. Taking
 * each player's top N instead stays readable at any volume.
 *
 * An edge survives if it is a top pick for *either* end, so a player's strongest
 * partner never vanishes just because that partner is popular — which also means
 * a node can end up with more than `n` edges. That asymmetry is the point.
 */
function topPerPlayer<
  E extends { key: string; lo: string; hi: string; games: number },
>(
  edges: E[],
  n: number,
): (E & { loPicked: boolean; hiPicked: boolean; mutual: boolean })[] {
  const kept: (E & {
    loPicked: boolean;
    hiPicked: boolean;
    mutual: boolean;
  })[] = [];
  const count = new Map<string, number>();
  const strongestFirst = [...edges].sort(
    (a, b) => b.games - a.games || a.key.localeCompare(b.key),
  );
  for (const e of strongestFirst) {
    const lo = count.get(e.lo) ?? 0;
    const hi = count.get(e.hi) ?? 0;
    if (lo >= n && hi >= n) continue;
    // Which end still had room is exactly "whose favourite is this?".
    const loPicked = lo < n;
    const hiPicked = hi < n;
    kept.push({ ...e, loPicked, hiPicked, mutual: loPicked && hiPicked });
    count.set(e.lo, lo + 1);
    count.set(e.hi, hi + 1);
  }
  return kept;
}

/**
 * Give every node a palette slot such that no two connected players share one.
 *
 * Colour cannot carry identity here: no palette of ~12 perceptually distinct
 * colours exists (validated — past six, pairs collide even for full colour
 * vision), and a roster has no upper bound. The labels carry identity instead,
 * which frees colour to do the one job it's actually needed for: telling the two
 * ends of an edge apart, which matters most for the two-tone foe edges.
 *
 * Greedy Welsh-Powell — highest degree first, lowest slot no neighbour holds.
 * Six slots colour a 12-player league cleanly at the default budget of 3. They
 * are not a guarantee: the caller colours friend and foe edges as one graph so
 * a player's colour survives the Friends/Foes toggle, and that union gets dense
 * enough at budget 5+ that a pair can be forced to share. When a node does run
 * out, the least-common neighbouring slot is reused rather than failing — every
 * node always comes back with a valid slot.
 */
export function assignColorSlots(
  nodeIds: string[],
  edges: { lo: string; hi: string }[],
  slotCount: number,
): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  for (const id of nodeIds) adj.set(id, new Set());
  for (const e of edges) {
    adj.get(e.lo)?.add(e.hi);
    adj.get(e.hi)?.add(e.lo);
  }
  // Degree order, id as tie-break, so the result is deterministic.
  const order = [...nodeIds].sort(
    (a, b) =>
      (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0) || a.localeCompare(b),
  );

  const slotOf = new Map<string, number>();
  for (const id of order) {
    const taken = new Set<number>();
    for (const nb of adj.get(id) ?? []) {
      const s = slotOf.get(nb);
      if (s !== undefined) taken.add(s);
    }
    let chosen = -1;
    for (let s = 0; s < slotCount; s++) {
      if (!taken.has(s)) {
        chosen = s;
        break;
      }
    }
    if (chosen === -1) {
      const freq = new Array<number>(slotCount).fill(0);
      for (const nb of adj.get(id) ?? []) {
        const s = slotOf.get(nb);
        if (s !== undefined) freq[s]++;
      }
      chosen = freq.indexOf(Math.min(...freq));
    }
    slotOf.set(id, chosen);
  }
  return slotOf;
}

/**
 * Build the league-wide player relationship graph for a season (or all-time when
 * `seasonId` is null). Pure — no DB access.
 *
 * Every match contributes two friend pairs (the two teams) and four foe pairs
 * (each player of team A against each player of team B).
 *
 * `topEdgesPerPlayer` filters edges only, never nodes: a player who turned up
 * still gets a dot even when none of their pairings survive.
 */
export function computeRelationshipGraph(
  seasonId: string | null,
  matches: Match[],
  players: Player[],
  topEdgesPerPlayer = 3,
): RelationshipGraphData {
  const seasonMatches = seasonId
    ? matches.filter((m) => m.season_id === seasonId)
    : matches;

  type NodeAcc = { games: number; wins: number; losses: number };
  type FriendAcc = { lo: string; hi: string; games: number; wins: number };
  type FoeAcc = { lo: string; hi: string; games: number; loWins: number };

  const nodeAcc = new Map<string, NodeAcc>();
  const friendAcc = new Map<string, FriendAcc>();
  const foeAcc = new Map<string, FoeAcc>();

  const bumpNode = (id: string, won: boolean) => {
    const n = nodeAcc.get(id) ?? { games: 0, wins: 0, losses: 0 };
    n.games++;
    if (won) n.wins++;
    else n.losses++;
    nodeAcc.set(id, n);
  };

  // A player can't partner or face themselves. Real matches never do this, but
  // malformed data would otherwise produce a self-loop, which renders as a
  // degenerate line and feeds source === target into d3's link force.
  const bumpFriend = (x: string, y: string, won: boolean) => {
    if (x === y) return;
    const key = teamKey(x, y);
    let e = friendAcc.get(key);
    if (!e) {
      const [lo, hi] = teamKeyParts(key);
      e = { lo, hi, games: 0, wins: 0 };
      friendAcc.set(key, e);
    }
    e.games++;
    if (won) e.wins++;
  };

  const bumpFoe = (x: string, y: string, xWon: boolean) => {
    if (x === y) return;
    const key = teamKey(x, y);
    let e = foeAcc.get(key);
    if (!e) {
      const [lo, hi] = teamKeyParts(key);
      e = { lo, hi, games: 0, loWins: 0 };
      foeAcc.set(key, e);
    }
    e.games++;
    // The key is undirected, so translate "x won" into "lo won": that holds when
    // x is the lo side and won, or x is the hi side and lost.
    if (xWon === (x === e.lo)) e.loWins++;
  };

  for (const m of seasonMatches) {
    const a: [string, string] = [m.team_a_player_1_id, m.team_a_player_2_id];
    const b: [string, string] = [m.team_b_player_1_id, m.team_b_player_2_id];
    const aWon = m.winning_team === "A";

    for (const pid of a) bumpNode(pid, aWon);
    for (const pid of b) bumpNode(pid, !aWon);

    bumpFriend(a[0], a[1], aWon);
    bumpFriend(b[0], b[1], !aWon);

    for (const x of a) {
      for (const y of b) bumpFoe(x, y, aWon);
    }
  }

  const playerById = new Map(players.map((p) => [p.id, p]));

  const nodes: RelationNode[] = [...nodeAcc.entries()]
    .filter(([id]) => playerById.has(id))
    .map(([id, n]) => {
      const p = playerById.get(id)!;
      return {
        id,
        name: p.name,
        elo: p.current_elo,
        games: n.games,
        wins: n.wins,
        losses: n.losses,
      };
    })
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  // An edge whose endpoint isn't a node (e.g. a since-deleted player still named
  // by an old match) would make d3's forceLink throw, so drop those outright.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const drawable = (e: { lo: string; hi: string }) =>
    nodeIds.has(e.lo) && nodeIds.has(e.hi);

  // Thinnest first, so the heaviest relationships paint on top.
  const byGames = (
    a: { games: number; key: string },
    b: { games: number; key: string },
  ) => a.games - b.games || a.key.localeCompare(b.key);

  const friends: FriendEdge[] = topPerPlayer(
    [...friendAcc.entries()]
      .map(([key, e]) => ({
        key,
        lo: e.lo,
        hi: e.hi,
        games: e.games,
        wins: e.wins,
        losses: e.games - e.wins,
      }))
      .filter(drawable),
    topEdgesPerPlayer,
  ).sort(byGames);

  const foes: FoeEdge[] = topPerPlayer(
    [...foeAcc.entries()]
      .map(([key, e]) => ({
        key,
        lo: e.lo,
        hi: e.hi,
        games: e.games,
        loWins: e.loWins,
        hiWins: e.games - e.loWins,
        loShare: e.loWins / e.games,
      }))
      .filter(drawable),
    topEdgesPerPlayer,
  ).sort(byGames);

  return {
    nodes,
    friends,
    foes,
    maxFriendGames: friends.reduce((mx, e) => Math.max(mx, e.games), 0),
    maxFoeGames: foes.reduce((mx, e) => Math.max(mx, e.games), 0),
    maxNodeGames: nodes.reduce((mx, n) => Math.max(mx, n.games), 0),
  };
}
