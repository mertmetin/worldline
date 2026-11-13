import { useMemo, useRef } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { Entity, World } from "../server/world";

interface GNode extends SimulationNodeDatum {
  id: string;
  e: Entity;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: "exit" | "at" | "rel";
  label?: string;
}

const W = 640;
const H = 520;
const R = { place: 22, character: 11, item: 7 } as const;

export function WorldGraph({
  world,
  changed,
  selected,
  onSelect,
}: {
  world: World;
  changed: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  // Keep positions between turns so the map doesn't reshuffle every time.
  const positions = useRef(new Map<string, { x: number; y: number }>());

  const { nodes, links } = useMemo(() => {
    const nodes: GNode[] = Object.values(world.entities).map((e) => ({ id: e.id, e, ...positions.current.get(e.id) }));
    const links: GLink[] = [];
    for (const e of Object.values(world.entities)) {
      for (const x of e.exits ?? []) if (e.id < x) links.push({ source: e.id, target: x, kind: "exit" });
      if (e.location && world.entities[e.location]) links.push({ source: e.id, target: e.location, kind: "at" });
    }
    for (const r of world.relations) links.push({ source: r.from, target: r.to, kind: "rel", label: r.rel });

    const sim = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((d) => d.id)
          .distance((l) => (l.kind === "exit" ? 120 : l.kind === "at" ? 34 : 90))
          .strength((l) => (l.kind === "rel" ? 0.03 : l.kind === "at" ? 1 : 0.6)),
      )
      .force("charge", forceManyBody<GNode>().strength((d) => (d.e.kind === "place" ? -520 : -60)))
      .force("collide", forceCollide<GNode>((d) => R[d.e.kind] + 6))
      .force("x", forceX(W / 2).strength(0.04))
      .force("y", forceY(H / 2).strength(0.06))
      .stop();
    sim.tick(positions.current.size ? 120 : 400);
    for (const n of nodes) {
      n.x = Math.max(30, Math.min(W - 30, n.x ?? W / 2));
      n.y = Math.max(30, Math.min(H - 30, n.y ?? H / 2));
      positions.current.set(n.id, { x: n.x, y: n.y });
    }
    return { nodes, links };
  }, [world]);

  const playerPlace = world.entities.player?.location;
  const sel = selected ? world.entities[selected] : null;
  const pos = (n: string | GNode) => (typeof n === "string" ? positions.current.get(n)! : { x: n.x!, y: n.y! });

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="graph" onClick={() => onSelect(null)} role="img" aria-label="World graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
          </marker>
        </defs>
        {links.map((l, i) => {
          const a = pos(l.source);
          const b = pos(l.target);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`link link-${l.kind}`}
              markerEnd={l.kind === "rel" ? "url(#arrow)" : undefined}
            >
              {l.label && <title>{l.label}</title>}
            </line>
          );
        })}
        {nodes.map((n) => {
          const e = n.e;
          const cls = [
            "node",
            `node-${e.kind}`,
            e.id === "player" && "node-player",
            e.id === playerPlace && "node-here",
            e.status === "dead" && "node-dead",
            changed.has(e.id) && "node-changed",
            e.id === selected && "node-selected",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className={cls}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelect(e.id);
              }}
            >
              <circle r={R[e.kind]} />
              {e.kind !== "item" && (
                <text y={e.kind === "place" ? R.place + 14 : R.character + 12} textAnchor="middle">
                  {e.name}
                </text>
              )}
              <title>{e.name}</title>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i className="dot dot-place" />Place</span>
        <span><i className="dot dot-character" />Character</span>
        <span><i className="dot dot-item" />Item</span>
        <span><i className="dot dot-changed" />Changed this turn</span>
      </div>
      {sel && <Inspector world={world} e={sel} />}
    </div>
  );
}

function Inspector({ world, e }: { world: World; e: Entity }) {
  const held = Object.values(world.entities).filter((x) => x.location === e.id && x.kind !== "place");
  const rels = world.relations.filter((r) => r.from === e.id || r.to === e.id);
  const facts = Object.values(world.facts).filter((f) => f.knownBy.includes(e.id));
  const name = (id: string) => world.entities[id]?.name ?? id;
  return (
    <aside className="inspector">
      <div className="inspector-kind">{e.kind}{e.status && e.status !== "alive" ? ` · ${e.status}` : ""}</div>
      <h3>{e.name}</h3>
      <p>{e.description}</p>
      {e.goal && <p className="muted"><b>Wants:</b> {e.goal}</p>}
      {e.location && <p className="muted"><b>At:</b> {name(e.location)}</p>}
      {Object.entries(e.attributes).length > 0 && (
        <p className="muted">{Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
      )}
      {held.length > 0 && <p className="muted"><b>{e.kind === "place" ? "Here" : "Carrying"}:</b> {held.map((h) => h.name).join(", ")}</p>}
      {rels.length > 0 && (
        <ul className="rels">
          {rels.map((r, i) => (
            <li key={i}>{name(r.from)} <em>{r.rel}</em> {name(r.to)}</li>
          ))}
        </ul>
      )}
      {facts.length > 0 && (
        <>
          <div className="inspector-kind">Knows</div>
          <ul className="rels">{facts.map((f) => <li key={f.id}>{f.text}</li>)}</ul>
        </>
      )}
    </aside>
  );
}
