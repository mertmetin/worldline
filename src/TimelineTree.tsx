import { useMemo } from "react";
import type { TurnNode } from "../server/timeline";

const DX = 64;
const DY = 34;

/** Horizontal tree of every turn ever played. Click a node to rewind to it. */
export function TimelineTree({
  nodes,
  rootId,
  currentId,
  onSelect,
}: {
  nodes: Record<string, TurnNode>;
  rootId: string;
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const layout = useMemo(() => {
    const children = new Map<string, TurnNode[]>();
    for (const n of Object.values(nodes)) {
      if (!n.parentId) continue;
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
    for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const pos = new Map<string, { x: number; y: number; depth: number }>();
    let row = 0;
    const place = (id: string, depth: number): number => {
      const kids = children.get(id) ?? [];
      let y: number;
      if (!kids.length) y = row++;
      else {
        const ys = kids.map((k) => place(k.id, depth + 1));
        y = ys[0];
      }
      pos.set(id, { x: 24 + depth * DX, y: 24 + y * DY, depth });
      return y;
    };
    place(rootId, 0);
    const onPath = new Set<string>();
    for (let n: TurnNode | undefined = nodes[currentId]; n; n = n.parentId ? nodes[n.parentId] : undefined) onPath.add(n.id);
    const maxX = Math.max(...[...pos.values()].map((p) => p.x)) + 40;
    const maxY = Math.max(...[...pos.values()].map((p) => p.y)) + 30;
    return { pos, onPath, width: Math.max(maxX, 200), height: Math.max(maxY, 60) };
  }, [nodes, rootId, currentId]);

  const { pos, onPath } = layout;
  const branches = Object.values(nodes).filter((n) => !Object.values(nodes).some((m) => m.parentId === n.id)).length;

  return (
    <div className="tree-wrap">
      <p className="muted small">
        {Object.keys(nodes).length - 1} turns across {branches} {branches === 1 ? "path" : "paths"}. Click any turn to rewind;
        your next action starts a new branch from there.
      </p>
      <div className="tree-scroll">
        <svg width={layout.width} height={layout.height} className="tree" role="img" aria-label="Timeline tree">
          {Object.values(nodes).map((n) => {
            if (!n.parentId) return null;
            const a = pos.get(n.parentId)!;
            const b = pos.get(n.id)!;
            const mid = (a.x + b.x) / 2;
            return (
              <path
                key={n.id}
                d={`M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`}
                className={onPath.has(n.id) ? "edge edge-on" : "edge"}
              />
            );
          })}
          {Object.values(nodes).map((n) => {
            const p = pos.get(n.id)!;
            const rejected = n.trace.filter((t) => !t.ok).length;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className={["tnode", onPath.has(n.id) && "tnode-on", n.id === currentId && "tnode-current"].filter(Boolean).join(" ")}
                onClick={() => onSelect(n.id)}
              >
                <circle r={n.id === currentId ? 9 : 7} />
                {rejected > 0 && <circle r={3} cx={7} cy={-7} className="tnode-flag" />}
                <title>
                  {n.parentId ? `Turn ${n.world.turn}: ${n.action}` : "Start"}
                  {rejected ? `\n${rejected} change(s) rejected by the checker` : ""}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
