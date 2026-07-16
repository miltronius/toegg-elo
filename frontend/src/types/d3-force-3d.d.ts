// d3-force-3d ships no types and has no @types package. It mirrors d3-force's
// API, adding numDimensions() on the simulation plus z/vz/fz on nodes, so a 2D
// layout is just numDimensions(2). Only the surface we actually use is declared.
declare module 'd3-force-3d' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum<N extends SimulationNodeDatum> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
  }

  export interface Force<N extends SimulationNodeDatum> {
    (alpha: number): void;
    initialize?(nodes: N[], ...args: unknown[]): void;
  }

  export interface ForceLink<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>>
    extends Force<N> {
    links(): L[];
    links(links: L[]): this;
    id(fn: (node: N) => string): this;
    distance(fn: (link: L) => number): this;
    strength(fn: (link: L) => number): this;
  }

  export interface ForceManyBody<N extends SimulationNodeDatum> extends Force<N> {
    strength(s: number): this;
  }

  export interface ForceCollide<N extends SimulationNodeDatum> extends Force<N> {
    radius(fn: (node: N) => number): this;
  }

  export interface ForcePositional<N extends SimulationNodeDatum> extends Force<N> {
    strength(s: number): this;
  }

  export interface Simulation<
    N extends SimulationNodeDatum,
    L extends SimulationLinkDatum<N>,
  > {
    numDimensions(n: 1 | 2 | 3): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(a: number): this;
    alphaTarget(a: number): this;
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
    // Reading back 'link' is typed concretely; it's the only force we mutate
    // after construction (swapping the link set on the Friends/Foes toggle).
    force(name: 'link'): ForceLink<N, L> | undefined;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    on(typenames: 'tick' | 'end', listener: (() => void) | null): this;
  }

  export function forceSimulation<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>>(
    nodes?: N[],
    numDimensions?: 1 | 2 | 3,
  ): Simulation<N, L>;

  export function forceLink<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>>(
    links?: L[],
  ): ForceLink<N, L>;

  export function forceManyBody<N extends SimulationNodeDatum>(): ForceManyBody<N>;
  export function forceCollide<N extends SimulationNodeDatum>(): ForceCollide<N>;
  export function forceCenter<N extends SimulationNodeDatum>(
    x?: number,
    y?: number,
    z?: number,
  ): Force<N>;
  export function forceX<N extends SimulationNodeDatum>(x?: number): ForcePositional<N>;
  export function forceY<N extends SimulationNodeDatum>(y?: number): ForcePositional<N>;
  export function forceZ<N extends SimulationNodeDatum>(z?: number): ForcePositional<N>;
}
