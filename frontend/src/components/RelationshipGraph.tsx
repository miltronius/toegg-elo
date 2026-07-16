import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force-3d";
import { Match, Player, PlayerSeasonStats, Season } from "../lib/supabase";
import {
  assignColorSlots,
  computeRelationshipGraph,
  type FoeEdge,
  type FriendEdge,
  type RelationNode,
} from "../lib/relationshipGraph";
import { RELGRAPH_SLOTS } from "../lib/colors";

interface RelationshipGraphProps {
  matches: Match[];
  players: Player[];
  seasons: Season[];
  onPlayerClick: (player: Player) => void;
  playerSeasonStats?: PlayerSeasonStats[];
}

type Mode = "friends" | "foes";

type SimNode = RelationNode & SimulationNodeDatum & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { games: number };

type Hover =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; key: string; x: number; y: number }
  | null;

type View = { k: number; tx: number; ty: number };
type Rot = { yaw: number; pitch: number };
/** A node's position after projection: screen point, depth scale, sort depth. */
type Proj = { sx: number; sy: number; scale: number; depth: number };

// Fallback size for the first paint and for jsdom, where the wrapper measures 0
// and ResizeObserver never fires — without it the graph would never render.
const FALLBACK_WIDTH = 600;
const FALLBACK_HEIGHT = 520;
const MIN_HEIGHT = 360;
// Breathing room below the canvas so the page doesn't gain a scrollbar.
const BOTTOM_GAP = 24;
// How far the pointer may travel before a press counts as a drag, not a click.
const DRAG_SLOP = 4;
// Start pulled back so the whole web is in frame with room to breathe.
const DEFAULT_ZOOM = 0.75;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
// Camera distance for the perspective divide. Large enough that the depth cue
// reads as depth rather than as a fisheye.
const FOCAL = 1200;
const ROT_SPEED = 0.008;
const MAX_PITCH = Math.PI / 2 - 0.05;
// Ticks run synchronously before the first paint. High enough that the graph
// arrives readable, low enough to leave some settling motion to watch.
const WARMUP_TICKS = 120;
// Label size in px, adjustable — legibility depends a lot on roster size and
// how far out you're zoomed, so it's a dial rather than a fixed value.
const DEFAULT_LABEL_SIZE = 15;
const MIN_LABEL_SIZE = 9;
const MAX_LABEL_SIZE = 28;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// Golden angle — spaces Fibonacci-sphere points without polar clustering.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Deterministic starting position: a ring in 2D, a sphere in 3D.
 *
 * The sphere isn't decoration. If every node starts at z = 0 the repulsion
 * between them has no z-component, so a 3D layout stays perfectly flat forever.
 * Giving it volume up front is what lets the forces work in three dimensions.
 */
function seedPosition(i: number, count: number, radius: number, is3d: boolean) {
  if (!is3d) {
    const angle = (i / Math.max(count, 1)) * 2 * Math.PI;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 };
  }
  const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  return {
    x: Math.cos(theta) * r * radius,
    y: y * radius,
    z: Math.sin(theta) * r * radius,
  };
}

const nodeRadius = (games: number, max: number) =>
  6 + 8 * Math.sqrt(games / Math.max(max, 1));

const edgeWidth = (games: number, max: number) =>
  1 + 5 * Math.sqrt(games / Math.max(max, 1));

// Repulsion has to scale with the room available per node, or the graph either
// collapses into a knot on a big canvas or flings nodes off a small one. The
// divisor is calibrated so a 12-player league fills most of a ~1400x800 canvas.
const chargeFor = (w: number, h: number, count: number) =>
  -Math.min(6000, Math.max(400, (w * h) / (Math.max(count, 1) * 40)));

/**
 * World → screen. Yaw then pitch, then a perspective divide.
 *
 * In 2D this is the identity: yaw/pitch are 0 and every z is 0, so scale is 1
 * and the node lands on its own simulation coordinates. That's deliberate —
 * both modes render through one path.
 */
function project(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  rot: Rot,
): Proj {
  const dx = x - cx;
  const dy = y - cy;
  const cyw = Math.cos(rot.yaw);
  const syw = Math.sin(rot.yaw);
  const x1 = dx * cyw + z * syw;
  const z1 = -dx * syw + z * cyw;
  const cp = Math.cos(rot.pitch);
  const sp = Math.sin(rot.pitch);
  const y2 = dy * cp - z1 * sp;
  const z2 = dy * sp + z1 * cp;
  const scale = FOCAL / (FOCAL + z2);
  return { sx: cx + x1 * scale, sy: cy + y2 * scale, scale, depth: z2 };
}

/** Screen → world at a fixed depth, so a dragged node keeps its distance. */
function unproject(
  sx: number,
  sy: number,
  depth: number,
  cx: number,
  cy: number,
  rot: Rot,
): { x: number; y: number; z: number } {
  const scale = FOCAL / (FOCAL + depth);
  const x1 = (sx - cx) / scale;
  const y2 = (sy - cy) / scale;
  const cp = Math.cos(rot.pitch);
  const sp = Math.sin(rot.pitch);
  const dy = y2 * cp + depth * sp;
  const z1 = -y2 * sp + depth * cp;
  const cyw = Math.cos(rot.yaw);
  const syw = Math.sin(rot.yaw);
  return {
    x: cx + x1 * cyw - z1 * syw,
    y: cy + dy,
    z: x1 * syw + z1 * cyw,
  };
}

export function RelationshipGraph({
  matches,
  players,
  seasons,
  onPlayerClick,
  playerSeasonStats,
}: RelationshipGraphProps) {
  const { t } = useTranslation();
  // Scoped locally rather than through App's shared selectedSeason, and defaulted
  // to all-time: relationships accrue over years, and one season is usually too
  // few matches to show any structure. Same approach as SeasonStats.
  const [scope, setScope] = useState<string>("all");
  const [mode, setMode] = useState<Mode>("friends");
  const [is3d, setIs3d] = useState(true);
  const [topEdges, setTopEdges] = useState(3);
  const [labelSize, setLabelSize] = useState(DEFAULT_LABEL_SIZE);
  const [hover, setHover] = useState<Hover>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rot, setRot] = useState<Rot>({ yaw: 0, pitch: 0 });
  // null = untouched, so the default zoom can follow the canvas size until the
  // user takes over. Same "no explicit choice yet" trick App uses for seasons.
  const [view, setView] = useState<View | null>(null);
  // d3 mutates the node objects in place, so each tick republishes the same
  // objects in a fresh array — that's what turns a tick into a render.
  const [nodes, setNodes] = useState<SimNode[]>([]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Mirrors `nodes` for effects and handlers only, never read while rendering.
  const nodesRef = useRef<SimNode[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const dragRef = useRef<{
    id: string;
    moved: boolean;
    sx: number;
    sy: number;
  } | null>(null);
  const bgRef = useRef<{
    px: number;
    py: number;
    tx: number;
    ty: number;
    yaw: number;
    pitch: number;
    pan: boolean;
  } | null>(null);
  // Read by the non-passive wheel listener, which can't close over live state.
  const viewRef = useRef<View>({ k: DEFAULT_ZOOM, tx: 0, ty: 0 });

  const scopeSeason = useMemo(
    () =>
      scope === "all" ? null : (seasons.find((s) => s.id === scope) ?? null),
    [scope, seasons],
  );

  // Season-normalized ELO for the tooltip, mirroring Teams. The all-time player
  // list is kept for onPlayerClick so PlayerDetail's All-Time view stays honest.
  const effectivePlayers = useMemo(() => {
    if (!scopeSeason || !playerSeasonStats?.length) return players;
    const statsMap = new Map(
      playerSeasonStats
        .filter((s) => s.season_id === scopeSeason.id)
        .map((s) => [s.player_id, s]),
    );
    return players.map((p) => {
      const s = statsMap.get(p.id);
      return s ? { ...p, current_elo: s.current_season_elo } : p;
    });
  }, [players, scopeSeason, playerSeasonStats]);

  const data = useMemo(
    () =>
      computeRelationshipGraph(
        scopeSeason?.id ?? null,
        matches,
        effectivePlayers,
        topEdges,
      ),
    [scopeSeason, matches, effectivePlayers, topEdges],
  );

  const width = size.w || FALLBACK_WIDTH;
  const height = size.h || FALLBACK_HEIGHT;
  const cx = width / 2;
  const cy = height / 2;

  // Pulled back around the canvas centre until the user scrolls.
  const v: View = view ?? {
    k: DEFAULT_ZOOM,
    tx: cx * (1 - DEFAULT_ZOOM),
    ty: cy * (1 - DEFAULT_ZOOM),
  };

  // Kept in sync for the wheel listener, which can't close over live state.
  useEffect(() => {
    viewRef.current = v;
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      // Fill the viewport below whatever chrome happens to sit above the canvas,
      // rather than hard-coding the header/nav/toolbar heights.
      const top = el.getBoundingClientRect().top;
      setSize({
        w: el.clientWidth,
        h: Math.max(MIN_HEIGHT, window.innerHeight - top - BOTTOM_GAP),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Wheel is registered by hand because React's synthetic handler is passive,
  // and zooming has to preventDefault to stop the page scrolling underneath.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cur = viewRef.current;
      const k = clamp(cur.k * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      // Anchor the zoom on the cursor: whatever is under it stays under it.
      setView({
        k,
        tx: px - (px - cur.tx) * (k / cur.k),
        ty: py - (py - cur.ty) * (k / cur.k),
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Rebuilds when the data, canvas or dimensionality changes — but NOT when
  // `mode` flips, which is what lets nodes hold position across the toggle.
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const ring = Math.min(width, height) / 3;

    const next: SimNode[] = data.nodes.map((n, i) => {
      const p = prev.get(n.id);
      const s = seedPosition(i, data.nodes.length, ring, is3d);
      // Hold position across a re-layout, but only when it's usable: coming from
      // 2D every z is 0, which is the degenerate flat case seedPosition exists
      // to avoid, so those nodes get re-seeded onto the sphere instead.
      const reuse = p != null && (!is3d || (p.z ?? 0) !== 0);
      return {
        ...n,
        r: nodeRadius(n.games, data.maxNodeGames),
        x: reuse ? p.x : cx + s.x,
        y: reuse ? p.y : cy + s.y,
        z: is3d ? (reuse ? p.z : s.z) : 0,
        vx: reuse ? p.vx : 0,
        vy: reuse ? p.vy : 0,
        vz: reuse ? p.vz : 0,
      };
    });
    nodesRef.current = next;

    const sim = forceSimulation<SimNode, SimLink>(next, is3d ? 3 : 2)
      .force(
        "link",
        forceLink<SimNode, SimLink>([]).id((d) => d.id),
      )
      .force(
        "charge",
        forceManyBody<SimNode>().strength(
          chargeFor(width, height, next.length),
        ),
      )
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => d.r + 6),
      )
      .force("center", forceCenter<SimNode>(cx, cy, 0))
      // Weak pull to the middle so players with no drawable edges don't drift off.
      .force("x", forceX<SimNode>(cx).strength(0.03))
      .force("y", forceY<SimNode>(cy).strength(0.03))
      .force("z", is3d ? forceZ<SimNode>(0).strength(0.03) : null)
      .on("tick", () => setNodes([...next]));

    simRef.current = sim;
    // The seeded positions above only reach the DOM through a render, and the
    // first tick is an rAF away (and never arrives under jsdom), so publish now.
    setNodes(next);
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [data, width, height, cx, cy, is3d]);

  // Swapping links on the existing simulation makes the toggle morph the edges
  // instead of relaying the whole graph.
  useEffect(() => {
    const sim = simRef.current;
    const linkForce = sim?.force("link");
    if (!sim || !linkForce) return;
    const edges = mode === "friends" ? data.friends : data.foes;
    const max = Math.max(
      mode === "friends" ? data.maxFriendGames : data.maxFoeGames,
      1,
    );
    linkForce
      .links(edges.map((e) => ({ source: e.lo, target: e.hi, games: e.games })))
      // Relative, not absolute: the strongest pairing in view pulls tight and
      // sits central, the weakest gets pushed out to the rim.
      .distance((l) => 60 + 260 * (1 - l.games / max))
      .strength((l) => (l.games / max) * 0.4);

    sim.alpha(0.8);
    // Untangling from the seed takes a few hundred ticks, and rendering every
    // one of them is what makes the graph feel heavy on arrival. Burn most of
    // them synchronously (tick() fires no events, so React never sees them),
    // then animate only the last, gentle part of the settle.
    sim.tick(WARMUP_TICKS);
    setNodes([...nodesRef.current]);
    sim.restart();
  }, [data, mode]);

  const projected = new Map<string, Proj>();
  for (const n of nodes) {
    projected.set(n.id, project(n.x ?? 0, n.y ?? 0, n.z ?? 0, cx, cy, rot));
  }

  // Coloured over both edge sets at once, so a player keeps their colour when
  // you flip Friends/Foes — only the roster or the filter can repaint them.
  const slotOf = useMemo(
    () =>
      assignColorSlots(
        data.nodes.map((n) => n.id),
        [...data.friends, ...data.foes],
        RELGRAPH_SLOTS,
      ),
    [data],
  );
  const colorOf = (id: string) => `var(--relgraph-c${(slotOf.get(id) ?? 0) + 1})`;

  const edges: (FriendEdge | FoeEdge)[] =
    mode === "friends" ? data.friends : data.foes;
  const maxEdgeGames =
    mode === "friends" ? data.maxFriendGames : data.maxFoeGames;

  // SVG has no depth buffer, so paint far-to-near by hand.
  const depthOf = (id: string) => projected.get(id)?.depth ?? 0;
  const sortedEdges = is3d
    ? [...edges].sort(
        (a, b) =>
          depthOf(b.lo) + depthOf(b.hi) - (depthOf(a.lo) + depthOf(a.hi)),
      )
    : edges;
  const sortedNodes = is3d
    ? [...nodes].sort((a, b) => depthOf(b.id) - depthOf(a.id))
    : nodes;

  const toGraph = (clientX: number, clientY: number, depth: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // Undo the zoom transform first, then the camera.
    const sx = (clientX - rect.left - v.tx) / v.k;
    const sy = (clientY - rect.top - v.ty) / v.k;
    return unproject(sx, sy, depth, cx, cy, rot);
  };

  const handlePointerDown = (
    e: React.PointerEvent<SVGCircleElement>,
    n: SimNode,
  ) => {
    e.stopPropagation();
    // Capture keeps the drag alive when the pointer outruns the small circle.
    // Optional because jsdom doesn't implement it on SVG elements.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id: n.id, moved: false, sx: e.clientX, sy: e.clientY };
    simRef.current?.alphaTarget(0.3).restart();
    n.fx = n.x;
    n.fy = n.y;
    if (is3d) n.fz = n.z;
  };

  const handlePointerMove = (
    e: React.PointerEvent<SVGCircleElement>,
    n: SimNode,
  ) => {
    const d = dragRef.current;
    if (!d || d.id !== n.id) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_SLOP)
      d.moved = true;
    // Through the camera and zoom, or the node drifts away from the cursor.
    // Depth is held constant so the node tracks the pointer in its own plane.
    const p = toGraph(e.clientX, e.clientY, projected.get(n.id)?.depth ?? 0);
    if (!p) return;
    n.fx = p.x;
    n.fy = p.y;
    if (is3d) n.fz = p.z;
  };

  const handlePointerUp = (n: SimNode) => {
    const d = dragRef.current;
    dragRef.current = null;
    simRef.current?.alphaTarget(0);
    n.fx = null;
    n.fy = null;
    n.fz = null;
    // A press that never moved is a click, not a throw.
    if (d && !d.moved) {
      const player = players.find((p) => p.id === n.id);
      if (player) onPlayerClick(player);
    }
  };

  // Dragging empty space orbits the camera in 3D and pans in 2D.
  const handleBackgroundDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    bgRef.current = {
      px: e.clientX,
      py: e.clientY,
      tx: v.tx,
      ty: v.ty,
      yaw: rot.yaw,
      pitch: rot.pitch,
      // Right button pans even in 3D, where left orbits. Button 1 is the
      // middle-click drag, which conventionally pans too.
      pan: e.button === 2 || e.button === 1,
    };
  };

  const handleBackgroundMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = bgRef.current;
    if (!b || dragRef.current) return;
    const dx = e.clientX - b.px;
    const dy = e.clientY - b.py;
    if (is3d && !b.pan) {
      setRot({
        // Negated so the graph follows the pointer like a trackball: drag right
        // and the near face travels right, rather than spinning away from you.
        yaw: b.yaw - dx * ROT_SPEED,
        pitch: clamp(b.pitch + dy * ROT_SPEED, -MAX_PITCH, MAX_PITCH),
      });
    } else {
      setView({ k: v.k, tx: b.tx + dx, ty: b.ty + dy });
    }
  };

  const handleBackgroundUp = () => {
    bgRef.current = null;
  };

  const tooltip = () => {
    if (!hover) return null;
    let body: React.ReactNode = null;

    if (hover.kind === "node") {
      const n = data.nodes.find((x) => x.id === hover.id);
      if (!n) return null;
      body = (
        <>
          <div className="relgraph-tip-title">{n.name}</div>
          <div className="relgraph-tip-sub">
            {t("relationshipGraph.nodeGames", { count: n.games })} ·{" "}
            {t("relationshipGraph.record", { wins: n.wins, losses: n.losses })}{" "}
            · {n.elo}
          </div>
        </>
      );
    } else {
      const edge = edges.find((e) => e.key === hover.key);
      if (!edge) return null;
      const loName = data.nodes.find((n) => n.id === edge.lo)?.name ?? "?";
      const hiName = data.nodes.find((n) => n.id === edge.hi)?.name ?? "?";

      if (mode === "friends") {
        const f = edge as FriendEdge;
        body = (
          <>
            <div className="relgraph-tip-title">
              {t("relationshipGraph.together", {
                a: loName,
                b: hiName,
                count: f.games,
              })}
            </div>
            {!f.mutual && (
              <div className="relgraph-tip-sub">
                {t("relationshipGraph.oneWay", {
                  a: f.loPicked ? loName : hiName,
                  b: f.loPicked ? hiName : loName,
                })}
              </div>
            )}
            <div className="relgraph-tip-sub">
              {t("relationshipGraph.record", {
                wins: f.wins,
                losses: f.losses,
              })}
            </div>
          </>
        );
      } else {
        const f = edge as FoeEdge;
        const leader =
          f.loWins === f.hiWins
            ? t("relationshipGraph.even", { wins: f.loWins, losses: f.hiWins })
            : t("relationshipGraph.leads", {
                name: f.loWins > f.hiWins ? loName : hiName,
                wins: Math.max(f.loWins, f.hiWins),
                losses: Math.min(f.loWins, f.hiWins),
              });
        body = (
          <>
            <div className="relgraph-tip-title">
              {t("relationshipGraph.versus", {
                a: loName,
                b: hiName,
                count: f.games,
              })}
            </div>
            <div className="relgraph-tip-sub">{leader}</div>
          </>
        );
      }
    }

    return createPortal(
      <div
        className="relgraph-tooltip"
        style={{
          position: "fixed",
          top: hover.y,
          left: hover.x + 14,
          transform: "translateY(-50%)",
          zIndex: 9999,
        }}
      >
        {body}
      </div>,
      document.body,
    );
  };

  return (
    <div className="card relgraph-card">
      {/* The canvas is far wider than it is tall, so the controls live in a side
          rail: it spends width we have to buy height we don't. */}
      <div className="relgraph-layout">
        <aside className="relgraph-controls">
          <h2 className="m-0 text-lg">{t("relationshipGraph.title")}</h2>

          <select
            className="season-select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">{t("relationshipGraph.allTime")}</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                S{s.number} · {s.name}
              </option>
            ))}
          </select>

          <div className="lb-toggle">
            <button
              className={`lb-toggle-btn ${mode === "friends" ? "active" : ""}`}
              aria-pressed={mode === "friends"}
              onClick={() => setMode("friends")}
            >
              {t("relationshipGraph.friends")}
            </button>
            <button
              className={`lb-toggle-btn ${mode === "foes" ? "active" : ""}`}
              aria-pressed={mode === "foes"}
              onClick={() => setMode("foes")}
            >
              {t("relationshipGraph.foes")}
            </button>
          </div>

          <div className="lb-toggle">
            <button
              className={`lb-toggle-btn ${!is3d ? "active" : ""}`}
              aria-pressed={!is3d}
              // Dropping to 2D flattens the graph, so the orbit goes with it.
              onClick={() => {
                setIs3d(false);
                setRot({ yaw: 0, pitch: 0 });
              }}
            >
              {t("relationshipGraph.twoD")}
            </button>
            <button
              className={`lb-toggle-btn ${is3d ? "active" : ""}`}
              aria-pressed={is3d}
              onClick={() => setIs3d(true)}
            >
              {t("relationshipGraph.threeD")}
            </button>
          </div>

          <label className="relgraph-slider">
            <span className="relgraph-slider-label">
              {mode === "friends"
                ? t("relationshipGraph.topPartners")
                : t("relationshipGraph.topRivals")}
              <span className="relgraph-slider-value">{topEdges}</span>
            </span>
            <input
              type="range"
              min={1}
              max={10}
              value={topEdges}
              onChange={(e) => setTopEdges(Number(e.target.value))}
            />
          </label>

          <label className="relgraph-slider">
            <span className="relgraph-slider-label">
              {t("relationshipGraph.labelSize")}
              <span className="relgraph-slider-value">{labelSize}</span>
            </span>
            <input
              type="range"
              min={MIN_LABEL_SIZE}
              max={MAX_LABEL_SIZE}
              value={labelSize}
              onChange={(e) => setLabelSize(Number(e.target.value))}
            />
          </label>

          <p className="relgraph-hint">
            {mode === "friends"
              ? t("relationshipGraph.friendsHint")
              : t("relationshipGraph.foesHint")}{" "}
            {is3d
              ? t("relationshipGraph.hint3d")
              : t("relationshipGraph.hint2d")}
          </p>
        </aside>

        <div className="relgraph-wrap" ref={wrapRef}>
          {data.nodes.length === 0 ? (
            <p className="relgraph-empty">{t("relationshipGraph.empty")}</p>
          ) : (
            <>
              {edges.length === 0 && (
                <p className="relgraph-empty">
                  {t("relationshipGraph.emptyEdges")}
                </p>
              )}
              <svg
                ref={svgRef}
                className={`relgraph-svg ${is3d ? "is-3d" : ""}`}
                width={width}
                height={height}
                onPointerDown={handleBackgroundDown}
                onPointerMove={handleBackgroundMove}
                onPointerUp={handleBackgroundUp}
                onPointerLeave={handleBackgroundUp}
                // Right-drag pans, so the context menu has to stay out of it.
                onContextMenu={(e) => e.preventDefault()}
              >
                <defs>
                  {/* auto-start-reverse lets one marker serve both ends: as a
                      markerStart it flips, so the arrow always points at the
                      player being picked. */}
                  <marker
                    id="relgraph-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                    markerUnits="strokeWidth"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-success)" />
                  </marker>
                </defs>
                <g transform={`translate(${v.tx} ${v.ty}) scale(${v.k})`}>
                  {sortedEdges.map((e) => {
                    const a = projected.get(e.lo);
                    const b = projected.get(e.hi);
                    if (!a || !b) return null;
                    const w = edgeWidth(e.games, maxEdgeGames);
                    const onEnter = (ev: React.MouseEvent) =>
                      setHover({
                        kind: "edge",
                        key: e.key,
                        x: ev.clientX,
                        y: ev.clientY,
                      });

                    // Foes split the line in two: the winner's colour eats into the
                    // loser's half, meeting at `loShare` along it. Friends are
                    // symmetric, so they get one neutral line and weight alone.
                    const share = mode === "foes" ? (e as FoeEdge).loShare : 0;
                    const mx = a.sx + (b.sx - a.sx) * share;
                    const my = a.sy + (b.sy - a.sy) * share;
                    // Fade edges that recede, so depth reads without a z-buffer.
                    const opacity = is3d
                      ? clamp((a.scale + b.scale) / 2, 0.35, 1)
                      : 1;

                    return (
                      <g key={e.key}>
                        {mode === "friends" ? (
                          <line
                            x1={a.sx}
                            y1={a.sy}
                            x2={b.sx}
                            y2={b.sy}
                            stroke="var(--color-success)"
                            strokeWidth={w}
                            strokeLinecap="round"
                            opacity={0.75 * opacity}
                            // Playing together is symmetric, but rating someone
                            // your favourite isn't: an arrow marks a one-way
                            // pick, and mutual pairs stay a plain line.
                            markerEnd={
                              (e as FriendEdge).loPicked &&
                              !(e as FriendEdge).hiPicked
                                ? "url(#relgraph-arrow)"
                                : undefined
                            }
                            markerStart={
                              (e as FriendEdge).hiPicked &&
                              !(e as FriendEdge).loPicked
                                ? "url(#relgraph-arrow)"
                                : undefined
                            }
                          />
                        ) : (
                          <>
                            <line
                              x1={a.sx}
                              y1={a.sy}
                              x2={mx}
                              y2={my}
                              stroke={colorOf(e.lo)}
                              strokeWidth={w}
                              strokeLinecap="round"
                              opacity={opacity}
                            />
                            <line
                              x1={mx}
                              y1={my}
                              x2={b.sx}
                              y2={b.sy}
                              stroke={colorOf(e.hi)}
                              strokeWidth={w}
                              strokeLinecap="round"
                              opacity={opacity}
                            />
                          </>
                        )}
                        {/* Fat invisible hit area so thin edges stay hoverable.
                          pointer-events="stroke" catches the stroke region
                          without painting it, unlike a transparent stroke,
                          which still costs a rasterisation pass every frame. */}
                        <line
                          x1={a.sx}
                          y1={a.sy}
                          x2={b.sx}
                          y2={b.sy}
                          stroke="none"
                          strokeWidth={Math.max(w, 14)}
                          pointerEvents="stroke"
                          onMouseEnter={onEnter}
                          onMouseMove={onEnter}
                          onMouseLeave={() => setHover(null)}
                        />
                      </g>
                    );
                  })}

                  {sortedNodes.map((n) => {
                    const p = projected.get(n.id);
                    if (!p) return null;
                    const r = n.r * (is3d ? p.scale : 1);
                    // One transform per node instead of four moving coordinates:
                    // the circle and its label ride along as a unit.
                    return (
                      <g key={n.id} transform={`translate(${p.sx} ${p.sy})`}>
                        <circle
                          className="relgraph-node"
                          r={r}
                          fill={colorOf(n.id)}
                          stroke="var(--card-bg)"
                          strokeWidth={2}
                          onPointerDown={(ev) => handlePointerDown(ev, n)}
                          onPointerMove={(ev) => handlePointerMove(ev, n)}
                          onPointerUp={() => handlePointerUp(n)}
                          onMouseEnter={(ev) =>
                            setHover({
                              kind: "node",
                              id: n.id,
                              x: ev.clientX,
                              y: ev.clientY,
                            })
                          }
                          onMouseMove={(ev) =>
                            setHover({
                              kind: "node",
                              id: n.id,
                              x: ev.clientX,
                              y: ev.clientY,
                            })
                          }
                          onMouseLeave={() => setHover(null)}
                        />
                        <text
                          className="relgraph-label"
                          y={r + labelSize * 0.9}
                          textAnchor="middle"
                          fill="var(--color-text)"
                          fontSize={labelSize}
                          opacity={is3d ? clamp(p.scale, 0.45, 1) : 1}
                        >
                          {n.name}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </>
          )}
        </div>
      </div>

      {tooltip()}
    </div>
  );
}
