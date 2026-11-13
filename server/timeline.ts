import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { checkInvariants, type World } from "./world";
import type { StoryBeat, TraceStep } from "./gm";
import { seedWorld } from "./seed";

// Every turn is a node holding a full snapshot of the world after it. Rewinding
// is just picking an older node; acting from it creates a sibling branch. Nothing
// is ever overwritten, so all explored paths stay visible.
export interface TurnNode {
  id: string;
  parentId: string | null;
  action: string;
  narration: string;
  offscreen: string[];
  trace: TraceStep[];
  world: World;
  model: string;
  usage: { input: number; output: number; requests: number };
  /** Invariant violations found after the turn; should always be empty. */
  violations: string[];
  createdAt: string;
}

export interface SaveFile {
  version: 1;
  rootId: string;
  nodes: Record<string, TurnNode>;
}

export class Timeline {
  private save: SaveFile;

  constructor(private file: string) {
    this.save = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SaveFile) : Timeline.fresh();
    this.persist();
  }

  static fresh(): SaveFile {
    const world = seedWorld();
    const root: TurnNode = {
      id: randomUUID(),
      parentId: null,
      action: "",
      narration: `${world.premise}\n\nYou stand in the village square as the light goes. A peddler is packing up his cart, and warm light spills from the tavern.`,
      offscreen: [],
      trace: [],
      world,
      model: "seed",
      usage: { input: 0, output: 0, requests: 0 },
      violations: [],
      createdAt: new Date().toISOString(),
    };
    return { version: 1, rootId: root.id, nodes: { [root.id]: root } };
  }

  get data(): SaveFile {
    return this.save;
  }

  get(id: string): TurnNode | undefined {
    return this.save.nodes[id];
  }

  /** Root → node, inclusive. */
  path(id: string): TurnNode[] {
    const out: TurnNode[] = [];
    for (let n = this.get(id); n; n = n.parentId ? this.get(n.parentId) : undefined) out.unshift(n);
    return out;
  }

  history(id: string): StoryBeat[] {
    return this.path(id).map((n) => ({ action: n.action || "(start)", narration: n.narration }));
  }

  add(parentId: string, node: Omit<TurnNode, "id" | "parentId" | "violations" | "createdAt">): TurnNode {
    const full: TurnNode = {
      ...node,
      id: randomUUID(),
      parentId,
      violations: checkInvariants(node.world),
      createdAt: new Date().toISOString(),
    };
    this.save.nodes[full.id] = full;
    this.persist();
    return full;
  }

  reset(): void {
    this.save = Timeline.fresh();
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.save, null, 2));
  }
}
