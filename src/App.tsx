import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TimelineResponse, type TurnNode } from "./api";
import { WorldGraph } from "./WorldGraph";
import { TimelineTree } from "./TimelineTree";

const SUGGESTIONS = ["Ask the peddler what he's selling", "Go to the tavern", "Walk up to the chapel", "Follow the cart tracks down Mill Road"];

export function App() {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"world" | "timeline">("world");
  const [selected, setSelected] = useState<string | null>(null);
  const storyEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.timeline().then((d) => {
      setData(d);
      // Resume at the most recent turn.
      const latest = Object.values(d.nodes).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      setCurrentId(latest.id);
    }, (e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    storyEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [currentId, pending]);

  const path = useMemo(() => {
    if (!data || !currentId) return [];
    const out: TurnNode[] = [];
    for (let n: TurnNode | undefined = data.nodes[currentId]; n; n = n.parentId ? data.nodes[n.parentId] : undefined) out.unshift(n);
    return out;
  }, [data, currentId]);

  const current = path[path.length - 1];
  const isLeaf = data && current ? !Object.values(data.nodes).some((n) => n.parentId === current.id) : true;

  const changed = useMemo(() => {
    const s = new Set<string>();
    if (path.length < 2) return s;
    const before = path[path.length - 2].world.entities;
    for (const [id, e] of Object.entries(current.world.entities)) if (JSON.stringify(e) !== JSON.stringify(before[id])) s.add(id);
    return s;
  }, [path, current]);

  const stats = useMemo(() => {
    if (!data) return null;
    const turns = Object.values(data.nodes).filter((n) => n.parentId);
    const steps = turns.flatMap((n) => n.trace);
    return {
      turns: turns.length,
      edits: steps.filter((s) => s.ok && s.tool !== "note_offscreen").length,
      rejected: steps.filter((s) => !s.ok).length,
      violations: turns.reduce((sum, n) => sum + n.violations.length, 0),
    };
  }, [data]);

  async function act(text: string) {
    if (!current || !text.trim() || pending) return;
    setPending(text.trim());
    setError(null);
    setAction("");
    try {
      const node = await api.turn(current.id, text.trim());
      setData((d) => (d ? { ...d, nodes: { ...d.nodes, [node.id]: node } } : d));
      setCurrentId(node.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAction(text);
    } finally {
      setPending(null);
    }
  }

  async function reset() {
    if (!confirm("Start over? This erases every branch.")) return;
    const fresh = await api.reset();
    setData((d) => (d ? { ...fresh, mode: d.mode } : d));
    setCurrentId(fresh.rootId);
    setSelected(null);
  }

  if (!data || !current) {
    return <div className="loading">{error ? `Can't reach the server: ${error}` : "Loading the world…"}</div>;
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Worldline</h1>
          <span className="subtitle">{current.world.title}</span>
        </div>
        {stats && (
          <div className="stats" title="Across every branch">
            <span><b>{stats.turns}</b> turns</span>
            <span><b>{stats.edits}</b> world edits</span>
            <span className={stats.rejected ? "warn" : ""}><b>{stats.rejected}</b> rejected by checker</span>
            <span className={stats.violations ? "bad" : "good"}><b>{stats.violations}</b> contradictions</span>
          </div>
        )}
        <div className="header-actions">
          <span className={`badge badge-${data.mode}`}>{data.mode === "ai" ? "AI game master" : "Offline mode"}</span>
          <button className="ghost" onClick={reset}>Restart</button>
        </div>
      </header>

      <main>
        <section className="story" aria-label="Story">
          <div className="story-scroll">
            {path.map((n) => (
              <article key={n.id} className={n.id === current.id ? "beat beat-current" : "beat"}>
                {n.parentId && <p className="you">› {n.action}</p>}
                {n.narration.split(/\n\n+/).map((p, i) => <p key={i}>{p}</p>)}
                {(n.trace.length > 0 || n.offscreen.length > 0) && <BehindTheScenes node={n} />}
              </article>
            ))}
            {pending && (
              <article className="beat">
                <p className="you">› {pending}</p>
                <p className="thinking">The game master is weighing the world…</p>
              </article>
            )}
            <div ref={storyEnd} />
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              act(action);
            }}
          >
            {!isLeaf && !pending && (
              <p className="branch-note">
                You rewound to turn {current.world.turn}. Your next action starts a new branch.
              </p>
            )}
            {error && <p className="error">{error}</p>}
            {path.length === 1 && !pending && (
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button type="button" key={s} className="chip" onClick={() => act(s)}>{s}</button>
                ))}
              </div>
            )}
            <div className="composer-row">
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="What do you do?"
                disabled={!!pending}
                maxLength={500}
                aria-label="Your action"
              />
              <button type="submit" disabled={!!pending || !action.trim()}>Act</button>
            </div>
          </form>
        </section>

        <section className="side" aria-label="World">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "world"} className={tab === "world" ? "tab on" : "tab"} onClick={() => setTab("world")}>World graph</button>
            <button role="tab" aria-selected={tab === "timeline"} className={tab === "timeline" ? "tab on" : "tab"} onClick={() => setTab("timeline")}>Timeline</button>
          </div>
          {tab === "world" ? (
            <WorldGraph world={current.world} changed={changed} selected={selected} onSelect={setSelected} />
          ) : (
            <TimelineTree nodes={data.nodes} rootId={data.rootId} currentId={current.id} onSelect={(id) => setCurrentId(id)} />
          )}
        </section>
      </main>
    </div>
  );
}

function BehindTheScenes({ node }: { node: TurnNode }) {
  const rejected = node.trace.filter((t) => !t.ok).length;
  return (
    <details className="scenes">
      <summary>
        Behind the scenes · {node.trace.length} tool call{node.trace.length === 1 ? "" : "s"}
        {rejected > 0 && <span className="warn"> · {rejected} rejected</span>}
        {node.usage.requests > 0 && <span className="muted"> · {node.usage.input + node.usage.output} tokens</span>}
      </summary>
      {node.offscreen.length > 0 && (
        <div className="offscreen">
          <b>Meanwhile, out of sight:</b>
          <ul>{node.offscreen.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
      <ol className="trace">
        {node.trace.map((t, i) => (
          <li key={i} className={t.ok ? "ok" : "rejected"}>
            <code>{t.tool}</code> <span className="args">{JSON.stringify(t.input)}</span>
            <div className="result">{t.ok ? "✓ " : "✗ rejected: "}{t.result}</div>
          </li>
        ))}
      </ol>
    </details>
  );
}
