import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  recordMatch,
  Player,
  PlayerSeasonStats,
  TeamNameRow,
  Match,
  MatchGame,
} from "../lib/supabase";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import { sortPlayersByName } from "../lib/playerSearch";
import {
  predictMatch,
  projectSeries,
  PlayerInput,
  PlayerProjection,
} from "../lib/eloPrediction";
import {
  DEFAULT_PARTNER_WEIGHT,
  MAX_SERIES_GAMES,
  effectiveRatings,
  getExpectedScore,
} from "../lib/elo";
import { getTeamNameForPlayers, getHeadToHead } from "../lib/teamUtils";

interface MatchFormProps {
  players: Player[];
  onMatchRecorded: () => void;
  playerSeasonStats?: PlayerSeasonStats[];
  teamNames?: TeamNameRow[];
  kFactor?: number;
  partnerWeight?: number;
  matches?: Match[];
}

/**
 * One row of the games list while it is being filled in.
 *
 * Goals are held as strings because the fields are optional and half-typed
 * states ("", "1") have to survive; `winner` is the explicit pick, used only
 * while the goals don't decide it themselves.
 */
type GameDraft = {
  winner: "A" | "B" | "";
  aGoals: string;
  bGoals: string;
};

const emptyGame = (): GameDraft => ({ winner: "", aGoals: "", bGoals: "" });

/**
 * Rows offered up front. Best-of-three is the usual session, so the form opens
 * on three - see `isBlankGame` for why offering more than was played is safe.
 */
const DEFAULT_GAME_ROWS = 3;

const freshGames = (): GameDraft[] =>
  Array.from({ length: DEFAULT_GAME_ROWS }, emptyGame);

const MAX_GOALS = 99;

function parseGoals(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_GOALS ? n : null;
}

/** Both goals given and different, and they disagree with nothing. */
function scoreDecides(game: GameDraft): "A" | "B" | null {
  const a = parseGoals(game.aGoals);
  const b = parseGoals(game.bGoals);
  if (a === null || b === null || a === b) return null;
  return a > b ? "A" : "B";
}

/** Who won this game, or "" while it is still undecided. */
function gameWinner(game: GameDraft): "A" | "B" | "" {
  return scoreDecides(game) ?? game.winner;
}

/** A full game, for the goal-field placeholders. Not enforced anywhere. */
const WINNING_GOALS = "10";

/**
 * What an empty goal field suggests. Once a winner is picked the two sides
 * stop being interchangeable, so the fields hint at the shape of a typical
 * result instead of a flat 0-0. Purely a hint - nothing reads it, and a game
 * left blank still records as a plain winner.
 */
function goalPlaceholder(winner: "A" | "B" | "", side: "A" | "B"): string {
  if (winner === "") return "0";
  return winner === side ? WINNING_GOALS : "0";
}

/** A game whose two goal counts are both filled in and equal cannot stand. */
function isLevelGame(game: GameDraft): boolean {
  const a = parseGoals(game.aGoals);
  const b = parseGoals(game.bGoals);
  return a !== null && b !== null && a === b;
}

/**
 * A row nobody touched, which is dropped rather than blocking the form.
 *
 * That is what lets three rows be offered by default: a 2-0 sweep leaves the
 * third alone instead of having to delete it. A row with *anything* typed in it
 * is not blank and still has to resolve to a winner - half-entered data is a
 * mistake worth reporting, not something to discard silently.
 */
function isBlankGame(game: GameDraft): boolean {
  return (
    game.winner === "" &&
    game.aGoals.trim() === "" &&
    game.bGoals.trim() === ""
  );
}

type Member = { name: string; elo: number };

type TeamBreakdown = {
  members: [Member, Member];
  /**
   * Opponents shown with their *effective* ratings, since that is what the
   * expectation is actually measured against - not their raw Elo, and not
   * their average.
   */
  opponents: [Member, Member];
  /** Per-game expected score for each member, in `members` order. */
  expected: [number, number];
};

/**
 * One decimal, always - the win-chance rows show their own arithmetic, and at
 * whole percent the rounding was visible in it: two terms displayed as 64% and
 * 85% average to 74.5 beside a result reading 74. A tenth keeps the slack below
 * what anyone checks by eye, and the fixed decimal keeps the column aligned
 * under `tabular-nums`. The headline odds bar stays at whole percent, where a
 * decimal would be false precision.
 */
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const weight = (value: number) => value.toFixed(2);

/**
 * The team's Elo, with the whole derivation behind a hover.
 *
 * The average is the honest headline number: blending a player towards their
 * partner moves credit between the two but leaves their sum - and so the team
 * average - untouched. The breakdown is hover-only because it is reference
 * material; nobody recording a match at lunchtime needs four lines of algebra
 * on screen, but the one person who wants to know why they gained 10 and their
 * partner gained 22 should be able to find out without reading the source.
 */
function TeamEloBadge({
  breakdown,
  partnerWeight,
}: {
  breakdown: TeamBreakdown;
  partnerWeight: number;
}) {
  const { t } = useTranslation();
  const { members, opponents, expected } = breakdown;

  const teamElo = Math.round((members[0].elo + members[1].elo) / 2);
  const own = 1 - partnerWeight;
  // Unrounded, because the duel percentages below are derived from it: rounding
  // first would leave the two halves not quite averaging to the expectation the
  // projection chips were computed from.
  const effectiveExact = (self: Member, partner: Member) =>
    own * self.elo + partnerWeight * partner.elo;
  const effective = (self: Member, partner: Member) =>
    Math.round(effectiveExact(self, partner));
  /** This player's chance against each opponent, in `opponents` order. */
  const duels = (self: Member, partner: Member) =>
    opponents.map((o) => getExpectedScore(effectiveExact(self, partner), o.elo));
  const teamChance = (expected[0] + expected[1]) / 2;

  const rows: [Member, Member][] = [
    [members[0], members[1]],
    [members[1], members[0]],
  ];

  return (
    <div className="team-elo" tabIndex={0}>
      <span className="team-elo-label">{t("matchForm.teamElo")}</span>
      <span className="team-elo-value">{teamElo}</span>

      <div className="team-elo-tip" role="tooltip">
        <div className="team-elo-tip-head">
          {t("matchForm.teamElo")} <strong>{teamElo}</strong>
        </div>
        <div className="team-elo-tip-sum">
          ({members[0].elo} + {members[1].elo}) ÷ 2
        </div>

        <div className="team-elo-tip-title">
          {t("matchForm.effectiveRating")}
          <span className="team-elo-tip-note">
            {t("matchForm.ownPartnerSplit", {
              own: weight(own),
              partner: weight(partnerWeight),
            })}
          </span>
        </div>
        <ul className="team-elo-tip-list">
          {rows.map(([self, partner]) => (
            <li key={self.name}>
              <span className="team-elo-tip-name">{self.name}</span>
              <span className="team-elo-tip-calc">
                {weight(own)}×{self.elo} + {weight(partnerWeight)}×{partner.elo}{" "}
                = <strong>{effective(self, partner)}</strong>
              </span>
            </li>
          ))}
        </ul>

        <div className="team-elo-tip-title">
          {t("matchForm.winChancePerGame")}
          <span className="team-elo-tip-note">
            {t("matchForm.versusOpponents", {
              opponents: opponents
                .map((o) => `${o.name} ${Math.round(o.elo)}`)
                .join(", "),
            })}
          </span>
        </div>
        <ul className="team-elo-tip-list">
          {rows.map(([self, partner], i) => {
            const [vs1, vs2] = duels(self, partner);
            return (
              <li key={self.name}>
                <span className="team-elo-tip-name">{self.name}</span>
                <span className="team-elo-tip-calc">
                  ({pct(vs1)} + {pct(vs2)}) ÷ 2 ={" "}
                  <strong>{pct(expected[i])}</strong>
                </span>
              </li>
            );
          })}
          <li className="team-elo-tip-total">
            <span className="team-elo-tip-name">{t("matchForm.team")}</span>
            <span className="team-elo-tip-calc">
              ({pct(expected[0])} + {pct(expected[1])}) ÷ 2 ={" "}
              <strong>{pct(teamChance)}</strong>
            </span>
          </li>
        </ul>
        <p className="team-elo-tip-note">{t("matchForm.eloCurveNote")}</p>
      </div>
    </div>
  );
}

function ProjectionChip({
  projection,
  delta,
}: {
  projection: PlayerProjection;
  delta?: number;
}) {
  const { t } = useTranslation();

  // Once the series has a decisive tally there is one outcome to show, not two.
  if (delta !== undefined) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center gap-1 px-2 py-1 rounded text-[0.75rem] font-medium mb-2",
          delta > 0 && "bg-success-light text-success",
          delta < 0 && "bg-error-light text-error",
          delta === 0 && "bg-bg text-text-light",
        )}
      >
        {projection.currentElo + delta} ({delta > 0 ? "+" : ""}
        {delta})
      </div>
    );
  }

  const winChange = projection.winElo - projection.currentElo;
  const loseChange = projection.loseElo - projection.currentElo;

  return (
    <div className="flex items-center gap-2 text-[0.75rem] mb-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <span className="flex-1 px-2 py-1 rounded bg-success-light text-success font-medium text-center">
        {t("matchForm.ifWin")} {projection.winElo} ({winChange > 0 ? "+" : ""}
        {winChange})
      </span>
      <span className="flex-1 px-2 py-1 rounded bg-error-light text-error font-medium text-center">
        {t("matchForm.ifLose")} {projection.loseElo} ({loseChange})
      </span>
    </div>
  );
}

export function MatchForm({
  players,
  onMatchRecorded,
  playerSeasonStats = [],
  teamNames = [],
  kFactor = 32,
  partnerWeight = DEFAULT_PARTNER_WEIGHT,
  matches = [],
}: MatchFormProps) {
  const { t } = useTranslation();
  const seasonEloMap = useMemo(
    () =>
      new Map(
        playerSeasonStats.map((s) => [s.player_id, s.current_season_elo]),
      ),
    [playerSeasonStats],
  );

  // Alphabetical rather than by Elo: the picker is for finding a name you
  // already have in mind, and a list that reshuffles as ratings change has no
  // stable place to look.
  const sortedPlayers = useMemo(() => sortPlayersByName(players), [players]);

  const [teamA1, setTeamA1] = useState("");
  const [teamA2, setTeamA2] = useState("");
  const [teamB1, setTeamB1] = useState("");
  const [teamB2, setTeamB2] = useState("");
  const [games, setGames] = useState<GameDraft[]>(freshGames);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const selectedPlayers = [teamA1, teamA2, teamB1, teamB2].filter(Boolean);
  const hasDuplicate = new Set(selectedPlayers).size !== selectedPlayers.length;
  const allSelected = !!(teamA1 && teamA2 && teamB1 && teamB2);

  const eloOf = (id: string) =>
    seasonEloMap.get(id) ??
    players.find((p) => p.id === id)?.current_elo ??
    1500;

  const lineupA: [PlayerInput, PlayerInput] = [
    { id: teamA1, elo: eloOf(teamA1) },
    { id: teamA2, elo: eloOf(teamA2) },
  ];
  const lineupB: [PlayerInput, PlayerInput] = [
    { id: teamB1, elo: eloOf(teamB1) },
    { id: teamB2, elo: eloOf(teamB2) },
  ];

  const prediction =
    !allSelected || hasDuplicate
      ? null
      : predictMatch(lineupA, lineupB, kFactor, partnerWeight);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "";

  // Opponents are listed at their *effective* ratings because that is what the
  // expectation is measured against - showing their raw Elo here would not add
  // up to the percentages beside it.
  const breakdowns = !prediction
    ? null
    : (() => {
        const member = (id: string): Member => ({
          name: nameOf(id),
          elo: eloOf(id),
        });
        const effA = effectiveRatings(lineupA[0].elo, lineupA[1].elo, partnerWeight);
        const effB = effectiveRatings(lineupB[0].elo, lineupB[1].elo, partnerWeight);
        const asOpponent = (id: string, elo: number): Member => ({
          name: nameOf(id),
          elo,
        });

        return {
          a: {
            members: [member(teamA1), member(teamA2)],
            opponents: [
              asOpponent(teamB1, effB[0]),
              asOpponent(teamB2, effB[1]),
            ],
            expected: [
              prediction.teamA[0].expected,
              prediction.teamA[1].expected,
            ],
          } as TeamBreakdown,
          b: {
            members: [member(teamB1), member(teamB2)],
            opponents: [
              asOpponent(teamA1, effA[0]),
              asOpponent(teamA2, effA[1]),
            ],
            expected: [
              prediction.teamB[0].expected,
              prediction.teamB[1].expected,
            ],
          } as TeamBreakdown,
        };
      })();

  const winners = games.map(gameWinner);
  // Untouched rows are spare slots, not part of the match.
  const played = games
    .map((game, index) => ({ game, winner: winners[index] }))
    .filter(({ game }) => !isBlankGame(game));

  const teamAGames = played.filter((p) => p.winner === "A").length;
  const teamBGames = played.filter((p) => p.winner === "B").length;
  const hasPlayed = played.length > 0;
  const everyGameDecided = played.every((p) => p.winner !== "");
  const anyLevelGame = played.some((p) => isLevelGame(p.game));
  const seriesLevel = teamAGames === teamBGames;
  const seriesReady =
    hasPlayed && everyGameDecided && !anyLevelGame && !seriesLevel;

  // Only price the series once it could actually be submitted, so the chips
  // never show a delta for a tally the edge function would reject.
  const seriesDeltas =
    prediction && seriesReady
      ? projectSeries(
          lineupA,
          lineupB,
          teamAGames,
          teamBGames,
          kFactor,
          partnerWeight,
        )
      : null;

  const teamAName =
    teamA1 && teamA2 && teamA1 !== teamA2
      ? getTeamNameForPlayers(teamA1, teamA2, teamNames)
      : null;
  const teamBName =
    teamB1 && teamB2 && teamB1 !== teamB2
      ? getTeamNameForPlayers(teamB1, teamB2, teamNames)
      : null;
  const teamALabel = teamAName
    ? `${t("matchForm.teamA")} (${teamAName})`
    : t("matchForm.teamA");
  const teamBLabel = teamBName
    ? `${t("matchForm.teamB")} (${teamBName})`
    : t("matchForm.teamB");

  const pctA = prediction
    ? Math.round(prediction.teamAWinProbability * 100)
    : 50;
  const pctB = prediction ? 100 - pctA : 50;

  const headToHead =
    !allSelected || hasDuplicate
      ? null
      : getHeadToHead([teamA1, teamA2], [teamB1, teamB2], matches);

  const updateGame = (index: number, patch: Partial<GameDraft>) =>
    setGames((prev) =>
      prev.map((game, i) => (i === index ? { ...game, ...patch } : game)),
    );

  const addGame = () =>
    setGames((prev) =>
      prev.length >= MAX_SERIES_GAMES ? prev : [...prev, emptyGame()],
    );

  const removeGame = (index: number) =>
    setGames((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!teamA1 || !teamA2 || !teamB1 || !teamB2) {
      setError(t("matchForm.selectAll"));
      return;
    }

    if (teamA1 === teamA2 || teamB1 === teamB2) {
      setError(t("matchForm.playersDifferent"));
      return;
    }

    if (hasDuplicate) {
      setError(t("matchForm.onePerTeam"));
      return;
    }

    if (!hasPlayed) {
      setError(t("matchForm.noGames"));
      return;
    }

    if (anyLevelGame) {
      setError(t("matchForm.levelGame"));
      return;
    }

    if (!everyGameDecided) {
      setError(t("matchForm.pickWinner"));
      return;
    }

    if (seriesLevel) {
      setError(t("matchForm.levelSeries"));
      return;
    }

    setLoading(true);

    try {
      const payload: MatchGame[] = played.map(({ game, winner }) => ({
        w: winner as "A" | "B",
        a: parseGoals(game.aGoals),
        b: parseGoals(game.bGoals),
      }));
      await recordMatch(teamA1, teamA2, teamB1, teamB2, payload);
      setSuccess(true);
      setTeamA1("");
      setTeamA2("");
      setTeamB1("");
      setTeamB2("");
      setGames(freshGames());
      onMatchRecorded();

      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("matchForm.recordError"));
    } finally {
      setLoading(false);
    }
  };

  const goalInputClass =
    "w-14 px-2 py-1 text-center rounded border border-border bg-bg text-text " +
    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none " +
    "[&::-webkit-inner-spin-button]:appearance-none";

  const winnerButtonClass = (selected: boolean, side: "A" | "B") =>
    clsx(
      "px-3 py-1 text-[0.8rem] font-semibold border transition-colors",
      side === "A" ? "rounded-l-md" : "rounded-r-md -ml-px",
      selected
        ? "bg-success-light border-success text-success z-10"
        : "bg-bg border-border text-text-light hover:border-primary hover:text-text",
    );

  return (
    <div className="card">
      <h2>{t("matchForm.title")}</h2>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start max-sm:grid-cols-1">
          <div
            className={clsx(
              "rounded-lg border-2 px-4 pb-4 pt-2 transition-colors",
              seriesReady && teamAGames > teamBGames
                ? "border-success bg-success-light/30"
                : "border-border",
            )}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="mt-0 mb-0 font-bold">{teamALabel}</h3>
              {breakdowns && (
                <TeamEloBadge
                  breakdown={breakdowns.a}
                  partnerWeight={partnerWeight}
                />
              )}
            </div>
            <PlayerAutocomplete
              label={t("matchForm.player1")}
              players={sortedPlayers}
              value={teamA1}
              onChange={setTeamA1}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamA1)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && (
              <ProjectionChip
                projection={prediction.teamA[0]}
                delta={seriesDeltas?.[teamA1]}
              />
            )}
            <PlayerAutocomplete
              label={t("matchForm.player2")}
              players={sortedPlayers}
              value={teamA2}
              onChange={setTeamA2}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamA2)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && (
              <ProjectionChip
                projection={prediction.teamA[1]}
                delta={seriesDeltas?.[teamA2]}
              />
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-2 pt-6 max-sm:order-first max-sm:pt-0 max-sm:pb-2">
            <div className="font-semibold text-text-light">
              {t("matchHistory.vs")}
            </div>
            {prediction ? (
              <div className="w-30">
                <div className="flex h-2.5 rounded-full overflow-hidden bg-border">
                  <div className="bg-primary" style={{ width: `${pctA}%` }} />
                  <div
                    className="bg-text-light"
                    style={{ width: `${pctB}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1 font-medium">
                  <span className="text-primary">{pctA}%</span>
                  <span className="text-text-light">{pctB}%</span>
                </div>
                <div className="text-[0.7rem] text-text-light text-center mt-0.5">
                  {t("matchForm.perGame")}
                </div>
                {headToHead && (
                  <div className="text-xs text-text-light text-center mt-3 w-30">
                    {headToHead.totalMatches === 0 ? (
                      t("matchForm.noPriorMatches")
                    ) : (
                      <>
                        <div>{t("matchForm.headToHead")}</div>
                        <div className="font-semibold text-text mt-0.5">
                          {headToHead.teamAWins} - {headToHead.teamBWins}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-light text-center w-30">
                {t("matchForm.previewHint")}
              </p>
            )}
          </div>

          <div
            className={clsx(
              "rounded-lg border-2 px-4 pb-4 pt-2 transition-colors",
              seriesReady && teamBGames > teamAGames
                ? "border-success bg-success-light/30"
                : "border-border",
            )}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="mt-0 mb-0 font-bold">{teamBLabel}</h3>
              {breakdowns && (
                <TeamEloBadge
                  breakdown={breakdowns.b}
                  partnerWeight={partnerWeight}
                />
              )}
            </div>
            <PlayerAutocomplete
              label={t("matchForm.player1")}
              players={sortedPlayers}
              value={teamB1}
              onChange={setTeamB1}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamB1)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && (
              <ProjectionChip
                projection={prediction.teamB[0]}
                delta={seriesDeltas?.[teamB1]}
              />
            )}
            <PlayerAutocomplete
              label={t("matchForm.player2")}
              players={sortedPlayers}
              value={teamB2}
              onChange={setTeamB2}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamB2)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && (
              <ProjectionChip
                projection={prediction.teamB[1]}
                delta={seriesDeltas?.[teamB2]}
              />
            )}
          </div>
        </div>

        <fieldset className="mt-5 border border-border rounded-lg px-4 pb-4 pt-2 min-w-0">
          <legend className="px-2 font-semibold text-[0.9rem]">
            {t("matchForm.games")}
          </legend>
          <p className="mt-0 mb-3 text-[0.78rem] text-text-light">
            {t("matchForm.gamesHint")}
          </p>

          <ol className="list-none p-0 m-0 flex flex-col gap-2">
            {games.map((game, index) => {
              const derived = scoreDecides(game);
              const winner = winners[index];
              const level = isLevelGame(game);

              return (
                <li key={index} className="flex items-center gap-2 flex-wrap">
                  <span className="w-5 text-[0.8rem] text-text-light tabular-nums">
                    {index + 1}.
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_GOALS}
                    className={goalInputClass}
                    value={game.aGoals}
                    placeholder={goalPlaceholder(winner, "A")}
                    disabled={loading}
                    aria-label={t("matchForm.goalsFor", {
                      team: teamALabel,
                      number: index + 1,
                    })}
                    onChange={(e) =>
                      updateGame(index, { aGoals: e.target.value })
                    }
                  />
                  <span className="text-text-light">-</span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_GOALS}
                    className={goalInputClass}
                    value={game.bGoals}
                    placeholder={goalPlaceholder(winner, "B")}
                    disabled={loading}
                    aria-label={t("matchForm.goalsFor", {
                      team: teamBLabel,
                      number: index + 1,
                    })}
                    onChange={(e) =>
                      updateGame(index, { bGoals: e.target.value })
                    }
                  />

                  <div
                    className="flex ml-1"
                    title={derived ? t("matchForm.winnerFromScore") : undefined}
                  >
                    {(["A", "B"] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        className={winnerButtonClass(winner === side, side)}
                        disabled={loading || derived !== null}
                        aria-pressed={winner === side}
                        aria-label={t("matchForm.winnerIs", {
                          team: side === "A" ? teamALabel : teamBLabel,
                          number: index + 1,
                        })}
                        onClick={() => updateGame(index, { winner: side })}
                      >
                        {side}
                      </button>
                    ))}
                  </div>

                  {level && (
                    <span className="text-[0.75rem] text-error">
                      {t("matchForm.levelGame")}
                    </span>
                  )}

                  <button
                    type="button"
                    className="ml-auto px-2 py-1 text-text-light rounded hover:text-error disabled:opacity-30 disabled:hover:text-text-light"
                    disabled={loading || games.length <= 1}
                    aria-label={t("matchForm.removeGame", {
                      number: index + 1,
                    })}
                    onClick={() => removeGame(index)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <button
              type="button"
              className="btn-secondary text-[0.8rem] py-1.5 px-3"
              disabled={loading || games.length >= MAX_SERIES_GAMES}
              onClick={addGame}
            >
              + {t("matchForm.addGame")}
            </button>

            <div className="text-[0.85rem]">
              <span className="text-text-light">{t("matchForm.series")} </span>
              <span className="font-semibold tabular-nums">
                {teamAGames} - {teamBGames}
              </span>
              {seriesReady && (
                <span className="ml-2 text-success font-semibold">
                  {teamAGames > teamBGames ? teamALabel : teamBLabel}
                </span>
              )}
              {hasPlayed && everyGameDecided && !anyLevelGame && seriesLevel && (
                <span className="ml-2 text-warning">
                  {t("matchForm.levelSeries")}
                </span>
              )}
            </div>
          </div>
        </fieldset>

        {error && (
          <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-3 mt-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-success-light text-success px-4 py-3 rounded-md text-sm border-l-4 border-success mb-3 mt-4">
            {t("matchForm.recorded")}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full mt-4"
          disabled={loading || !allSelected || hasDuplicate || !seriesReady}
        >
          {loading ? t("matchForm.recording") : t("matchForm.title")}
        </button>
      </form>
    </div>
  );
}
