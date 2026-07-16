import { describe, it, expect } from 'vitest';
import { assignColorSlots, computeRelationshipGraph } from './relationshipGraph';
import { teamKey } from './teamUtils';
import type { Match, Player } from './supabase';

// ── helpers ──────────────────────────────────────────────────────────────────

function makePlayer(id: string, name = id, elo = 1500): Player {
  return {
    id,
    name,
    current_elo: elo,
    matches_played: 0,
    wins: 0,
    losses: 0,
    created_at: '',
    anonymous_name: null,
  };
}

let mc = 0;
function makeMatch(o: Partial<Match> = {}): Match {
  return {
    id: `m${++mc}`,
    team_a_player_1_id: 'p1',
    team_a_player_2_id: 'p2',
    team_b_player_1_id: 'p3',
    team_b_player_2_id: 'p4',
    winning_team: 'A',
    season_id: 's1',
    created_at: '2024-01-15T10:00:00Z',
    ...o,
  };
}

const PLAYERS = ['p1', 'p2', 'p3', 'p4'].map((id) => makePlayer(id));

const friendFor = (g: ReturnType<typeof computeRelationshipGraph>, a: string, b: string) =>
  g.friends.find((e) => e.key === teamKey(a, b));
const foeFor = (g: ReturnType<typeof computeRelationshipGraph>, a: string, b: string) =>
  g.foes.find((e) => e.key === teamKey(a, b));

// ── shape: what one match produces ───────────────────────────────────────────

describe('computeRelationshipGraph — edges produced per match', () => {
  it('turns one match into 4 nodes, 2 friend edges and 4 foe edges', () => {
    const g = computeRelationshipGraph('s1', [makeMatch()], PLAYERS);

    expect(g.nodes).toHaveLength(4);
    expect(g.friends).toHaveLength(2);
    expect(g.foes).toHaveLength(4);
  });

  it('pairs teammates, not opponents, on friend edges', () => {
    const g = computeRelationshipGraph('s1', [makeMatch()], PLAYERS);

    expect(friendFor(g, 'p1', 'p2')).toBeDefined();
    expect(friendFor(g, 'p3', 'p4')).toBeDefined();
    // p1 and p3 were on opposite teams, so they are foes, never friends.
    expect(friendFor(g, 'p1', 'p3')).toBeUndefined();
    expect(foeFor(g, 'p1', 'p3')).toBeDefined();
  });

  it('records the winning pair as winning together and the losing pair as losing', () => {
    const g = computeRelationshipGraph('s1', [makeMatch({ winning_team: 'A' })], PLAYERS);

    expect(friendFor(g, 'p1', 'p2')).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(friendFor(g, 'p3', 'p4')).toMatchObject({ games: 1, wins: 0, losses: 1 });
  });

  it('counts node wins and losses per side', () => {
    const g = computeRelationshipGraph('s1', [makeMatch({ winning_team: 'B' })], PLAYERS);
    const node = (id: string) => g.nodes.find((n) => n.id === id);

    expect(node('p1')).toMatchObject({ games: 1, wins: 0, losses: 1 });
    expect(node('p3')).toMatchObject({ games: 1, wins: 1, losses: 0 });
  });
});

// ── the crux: a directional record on an undirected key ──────────────────────

describe('computeRelationshipGraph — foe records are stored from lo\'s side', () => {
  // 'a' < 'z', so teamKey('a','z') === 'a:z' and lo is always 'a'. Feeding the
  // same rivalry in with the sides swapped must not flip the record.
  const wide = [makePlayer('a'), makePlayer('m'), makePlayer('z'), makePlayer('n')];

  it('credits lo when the lo player wins', () => {
    const m = makeMatch({
      team_a_player_1_id: 'a',
      team_a_player_2_id: 'm',
      team_b_player_1_id: 'z',
      team_b_player_2_id: 'n',
      winning_team: 'A',
    });
    const g = computeRelationshipGraph('s1', [m], wide);
    const e = foeFor(g, 'a', 'z')!;

    expect(e.lo).toBe('a');
    expect(e).toMatchObject({ games: 1, loWins: 1, hiWins: 0, loShare: 1 });
  });

  it('credits hi when the lo player loses', () => {
    const m = makeMatch({
      team_a_player_1_id: 'a',
      team_a_player_2_id: 'm',
      team_b_player_1_id: 'z',
      team_b_player_2_id: 'n',
      winning_team: 'B',
    });
    const g = computeRelationshipGraph('s1', [m], wide);

    expect(foeFor(g, 'a', 'z')).toMatchObject({ games: 1, loWins: 0, hiWins: 1, loShare: 0 });
  });

  it('gives the same record when the players swap sides of the table', () => {
    // 'a' is on side B this time, and still wins.
    const m = makeMatch({
      team_a_player_1_id: 'z',
      team_a_player_2_id: 'n',
      team_b_player_1_id: 'a',
      team_b_player_2_id: 'm',
      winning_team: 'B',
    });
    const g = computeRelationshipGraph('s1', [m], wide);

    expect(foeFor(g, 'a', 'z')).toMatchObject({ loWins: 1, hiWins: 0, loShare: 1 });
  });

  it('accumulates a lopsided rivalry across matches', () => {
    const aWins = Array.from({ length: 8 }, () =>
      makeMatch({
        team_a_player_1_id: 'a', team_a_player_2_id: 'm',
        team_b_player_1_id: 'z', team_b_player_2_id: 'n',
        winning_team: 'A',
      }),
    );
    // Swap sides for the losses too, to prove side doesn't leak into the record.
    const zWins = Array.from({ length: 2 }, () =>
      makeMatch({
        team_a_player_1_id: 'z', team_a_player_2_id: 'n',
        team_b_player_1_id: 'a', team_b_player_2_id: 'm',
        winning_team: 'A',
      }),
    );
    const g = computeRelationshipGraph('s1', [...aWins, ...zWins], wide);

    expect(foeFor(g, 'a', 'z')).toMatchObject({ games: 10, loWins: 8, hiWins: 2, loShare: 0.8 });
  });

  it('splits an even rivalry down the middle', () => {
    const g = computeRelationshipGraph(
      's1',
      [
        makeMatch({ winning_team: 'A' }),
        makeMatch({ winning_team: 'B' }),
      ],
      PLAYERS,
    );
    const e = foeFor(g, 'p1', 'p3')!;

    expect(e.games).toBe(2);
    expect(e.loShare).toBe(0.5);
    expect(e.loWins).toBe(e.hiWins);
  });

  it('always keeps hiWins as the complement of loWins', () => {
    const g = computeRelationshipGraph(
      's1',
      [makeMatch({ winning_team: 'A' }), makeMatch({ winning_team: 'A' }), makeMatch({ winning_team: 'B' })],
      PLAYERS,
    );

    for (const e of g.foes) {
      expect(e.loWins + e.hiWins).toBe(e.games);
      expect(e.loShare).toBeCloseTo(e.loWins / e.games);
    }
  });
});

// ── season scoping ───────────────────────────────────────────────────────────

describe('computeRelationshipGraph — season scoping', () => {
  const matches = [
    makeMatch({ season_id: 's1' }),
    makeMatch({ season_id: 's2' }),
    makeMatch({ season_id: 's2' }),
  ];

  it('counts only the requested season', () => {
    expect(friendFor(computeRelationshipGraph('s1', matches, PLAYERS), 'p1', 'p2')!.games).toBe(1);
    expect(friendFor(computeRelationshipGraph('s2', matches, PLAYERS), 'p1', 'p2')!.games).toBe(2);
  });

  it('counts every season when seasonId is null', () => {
    expect(friendFor(computeRelationshipGraph(null, matches, PLAYERS), 'p1', 'p2')!.games).toBe(3);
  });
});

// ── minGames, nodes and scaling maxima ───────────────────────────────────────

describe('computeRelationshipGraph — topEdgesPerPlayer and nodes', () => {
  it('keeps only each player\'s strongest partnerships', () => {
    // p1 partners p2 three times and p3 once, so with a budget of 1 the p1+p3
    // pairing loses out to the stronger p1+p2 one.
    const matches = [
      makeMatch(),
      makeMatch(),
      makeMatch(),
      makeMatch({
        team_a_player_1_id: 'p1', team_a_player_2_id: 'p3',
        team_b_player_1_id: 'p2', team_b_player_2_id: 'p4',
      }),
    ];
    const g = computeRelationshipGraph('s1', matches, PLAYERS, 1);

    expect(friendFor(g, 'p1', 'p2')).toBeDefined();
    expect(friendFor(g, 'p1', 'p3')).toBeUndefined();
    // Nodes are untouched by the edge budget.
    expect(g.nodes).toHaveLength(4);
  });

  it('keeps an edge that is a top pick for only one of its two players', () => {
    // p1+p2 partner 3x (both their favourite). p3+p4 partner 3x likewise. One
    // stray match pairs p1+p3 — p1 already has a stronger partner, but for a
    // budget of 1 this is still nobody's top pick, so it goes.
    const g = computeRelationshipGraph(
      's1',
      [
        makeMatch(), makeMatch(), makeMatch(),
        makeMatch({
          team_a_player_1_id: 'p1', team_a_player_2_id: 'p3',
          team_b_player_1_id: 'p2', team_b_player_2_id: 'p4',
        }),
      ],
      PLAYERS,
      1,
    );
    expect(friendFor(g, 'p1', 'p3')).toBeUndefined();

    // With a budget of 2 it survives, because it's each player's 2nd strongest.
    const g2 = computeRelationshipGraph(
      's1',
      [
        makeMatch(), makeMatch(), makeMatch(),
        makeMatch({
          team_a_player_1_id: 'p1', team_a_player_2_id: 'p3',
          team_b_player_1_id: 'p2', team_b_player_2_id: 'p4',
        }),
      ],
      PLAYERS,
      2,
    );
    expect(friendFor(g2, 'p1', 'p3')).toBeDefined();
  });

  it('thins a fully-connected league', () => {
    // Every pair of the 6 players faces each other once, with the remaining two
    // filling out the teams — so all C(6,2) = 15 foe pairs exist.
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makePlayer(id));
    const ms: Match[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const rest = [0, 1, 2, 3, 4, 5].filter((k) => k !== i && k !== j);
        ms.push(makeMatch({
          team_a_player_1_id: six[i].id, team_a_player_2_id: six[rest[0]].id,
          team_b_player_1_id: six[j].id, team_b_player_2_id: six[rest[1]].id,
        }));
      }
    }
    const all = computeRelationshipGraph('s1', ms, six, 99);
    const top2 = computeRelationshipGraph('s1', ms, six, 2);

    // Complete graph before filtering — the exact problem the budget solves.
    expect(all.foes).toHaveLength(15);
    expect(top2.foes.length).toBeLessThan(all.foes.length);
    // The budget only removes lines, never players.
    expect(top2.nodes).toHaveLength(6);
  });

  it('marks a partnership mutual when both ends rate it a favourite', () => {
    // p1+p2 and p3+p4 only ever partner each other, so each is the other's top.
    const g = computeRelationshipGraph('s1', [makeMatch(), makeMatch()], PLAYERS, 1);

    expect(friendFor(g, 'p1', 'p2')).toMatchObject({
      loPicked: true,
      hiPicked: true,
      mutual: true,
    });
  });

  it('flags an unrequited favourite as one-way', () => {
    // p1 partners p3 once; p3 partners p4 twice. With a budget of 1, p1+p3 is
    // p1's only (so top) partner, but p3 prefers p4 — the pick isn't returned.
    const matches = [
      makeMatch({
        team_a_player_1_id: 'p3', team_a_player_2_id: 'p4',
        team_b_player_1_id: 'p5', team_b_player_2_id: 'p6',
      }),
      makeMatch({
        team_a_player_1_id: 'p3', team_a_player_2_id: 'p4',
        team_b_player_1_id: 'p5', team_b_player_2_id: 'p6',
      }),
      makeMatch({
        team_a_player_1_id: 'p1', team_a_player_2_id: 'p3',
        team_b_player_1_id: 'p5', team_b_player_2_id: 'p6',
      }),
    ];
    const roster = ['p1', 'p3', 'p4', 'p5', 'p6'].map((id) => makePlayer(id));
    const g = computeRelationshipGraph('s1', matches, roster, 1);

    // p3+p4 is the stronger pairing and is mutual.
    expect(friendFor(g, 'p3', 'p4')).toMatchObject({ mutual: true });
    // p1+p3 survives only because p1 still had room — p3 did not.
    const oneWay = friendFor(g, 'p1', 'p3');
    expect(oneWay).toBeDefined();
    expect(oneWay!.mutual).toBe(false);
    // p1 is the one doing the picking (lo is whichever id sorts first).
    const p1IsLo = oneWay!.lo === 'p1';
    expect(p1IsLo ? oneWay!.loPicked : oneWay!.hiPicked).toBe(true);
    expect(p1IsLo ? oneWay!.hiPicked : oneWay!.loPicked).toBe(false);
  });

  it('ignores a player paired with themselves', () => {
    // Not reachable through the UI, but a self-loop would break the layout.
    const g = computeRelationshipGraph(
      's1',
      [makeMatch({ team_a_player_1_id: 'p1', team_a_player_2_id: 'p1' })],
      PLAYERS,
    );

    expect([...g.friends, ...g.foes].some((e) => e.lo === e.hi)).toBe(false);
  });

  it('excludes players with no matches in scope', () => {
    const g = computeRelationshipGraph('s1', [makeMatch()], [...PLAYERS, makePlayer('ghost')]);

    expect(g.nodes.map((n) => n.id)).not.toContain('ghost');
  });

  it('drops edges pointing at a player who is no longer in the roster', () => {
    // p4 has been deleted, but an old match still names them.
    const g = computeRelationshipGraph('s1', [makeMatch()], PLAYERS.slice(0, 3));

    expect(g.nodes.map((n) => n.id)).toEqual(expect.not.arrayContaining(['p4']));
    expect([...g.friends, ...g.foes].some((e) => e.lo === 'p4' || e.hi === 'p4')).toBe(false);
    // The p3/p4 partnership goes with it; p1+p2 survives.
    expect(friendFor(g, 'p1', 'p2')).toBeDefined();
    expect(friendFor(g, 'p3', 'p4')).toBeUndefined();
  });

  it('carries the player display name and ELO onto the node', () => {
    const g = computeRelationshipGraph('s1', [makeMatch()], [
      makePlayer('p1', 'Ann', 1620),
      ...PLAYERS.slice(1),
    ]);

    expect(g.nodes.find((n) => n.id === 'p1')).toMatchObject({ name: 'Ann', elo: 1620 });
  });

  it('reports the maxima used for width and radius scaling', () => {
    const g = computeRelationshipGraph('s1', [makeMatch(), makeMatch()], PLAYERS);


    expect(g.maxNodeGames).toBe(2);
    expect(g.maxFriendGames).toBe(2);
    expect(g.maxFoeGames).toBe(2);
  });

  it('returns zeroed maxima rather than -Infinity when there is nothing to draw', () => {
    const g = computeRelationshipGraph('s1', [], PLAYERS);

    expect(g).toMatchObject({
      nodes: [],
      friends: [],
      foes: [],
      maxNodeGames: 0,
      maxFriendGames: 0,
      maxFoeGames: 0,
    });
  });
});

// ── colour slots ─────────────────────────────────────────────────────────────

describe('assignColorSlots', () => {
  it('never gives two linked players the same slot', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const edges = [
      { lo: 'a', hi: 'b' },
      { lo: 'b', hi: 'c' },
      { lo: 'c', hi: 'd' },
      { lo: 'a', hi: 'd' },
    ];
    const slots = assignColorSlots(ids, edges, 6);

    for (const e of edges) {
      expect(slots.get(e.lo)).not.toBe(slots.get(e.hi));
    }
  });

  it('colours a real league cleanly at the default budget', () => {
    // The point of the six slots: at the budget users actually sit on, no two
    // connected players share a colour. Higher budgets thicken the friend+foe
    // union past what six slots can always cover — see the next test.
    const roster = Array.from({ length: 12 }, (_, i) => makePlayer(`q${i}`));
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const ms = Array.from({ length: 240 }, () => {
      const p = [...roster].sort(() => rnd() - 0.5).slice(0, 4);
      return makeMatch({
        team_a_player_1_id: p[0].id, team_a_player_2_id: p[1].id,
        team_b_player_1_id: p[2].id, team_b_player_2_id: p[3].id,
        winning_team: rnd() > 0.5 ? 'A' : 'B',
      });
    });

    for (const top of [1, 2, 3]) {
      const g = computeRelationshipGraph('s1', ms, roster, top);
      const slots = assignColorSlots(
        g.nodes.map((n) => n.id),
        [...g.friends, ...g.foes],
        6,
      );
      const clashes = [...g.friends, ...g.foes].filter(
        (e) => slots.get(e.lo) === slots.get(e.hi),
      );
      expect(clashes, `top-${top} produced same-colour neighbours`).toEqual([]);
    }
  });

  it('still colours every node when the budget outgrows the six slots', () => {
    // At budget 5+ the friend+foe union is dense enough that six slots can be
    // forced to repeat on a pair. That's tolerated — names carry identity — but
    // every player must still get a valid slot.
    const roster = Array.from({ length: 12 }, (_, i) => makePlayer(`q${i}`));
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const ms = Array.from({ length: 240 }, () => {
      const p = [...roster].sort(() => rnd() - 0.5).slice(0, 4);
      return makeMatch({
        team_a_player_1_id: p[0].id, team_a_player_2_id: p[1].id,
        team_b_player_1_id: p[2].id, team_b_player_2_id: p[3].id,
        winning_team: rnd() > 0.5 ? 'A' : 'B',
      });
    });

    const g = computeRelationshipGraph('s1', ms, roster, 6);
    const slots = assignColorSlots(
      g.nodes.map((n) => n.id),
      [...g.friends, ...g.foes],
      6,
    );

    expect(slots.size).toBe(g.nodes.length);
    for (const s of slots.values()) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(6);
    }
  });

  it('reuses a slot rather than failing when a node runs out', () => {
    // A 4-clique cannot be 3-coloured, so something has to give — but every
    // node must still come back with a valid slot.
    const ids = ['a', 'b', 'c', 'd'];
    const edges = [
      { lo: 'a', hi: 'b' }, { lo: 'a', hi: 'c' }, { lo: 'a', hi: 'd' },
      { lo: 'b', hi: 'c' }, { lo: 'b', hi: 'd' }, { lo: 'c', hi: 'd' },
    ];
    const slots = assignColorSlots(ids, edges, 3);

    expect([...slots.keys()].sort()).toEqual(ids);
    for (const s of slots.values()) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(3);
    }
  });

  it('is deterministic', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const edges = [{ lo: 'a', hi: 'b' }, { lo: 'b', hi: 'c' }, { lo: 'c', hi: 'd' }];

    expect([...assignColorSlots(ids, edges, 6)]).toEqual([...assignColorSlots(ids, edges, 6)]);
  });
});
