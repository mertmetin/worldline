// The world graph and the rules that keep it consistent.
//
// The game master (an LLM) never edits the world directly. It proposes
// operations; `applyOp` checks each one against the current state and either
// applies it or rejects it with a reason the model can act on. Rejections are
// recorded, which is what the consistency metrics are built from.

export type Kind = "place" | "character" | "item";
export type Status = "alive" | "dead" | "missing";

export interface Entity {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  /** Characters and items: the place (or, for items, the character) they are in. */
  location?: string;
  /** Places only: ids of directly connected places. */
  exits?: string[];
  /** Characters only. */
  status?: Status;
  /** Characters only: what they want. Drives NPC behaviour. */
  goal?: string;
  attributes: Record<string, string>;
}

export interface Relation {
  from: string;
  rel: string;
  to: string;
}

export interface Fact {
  id: string;
  text: string;
  /** Character ids who know this fact. */
  knownBy: string[];
}

export interface World {
  title: string;
  premise: string;
  turn: number;
  entities: Record<string, Entity>;
  relations: Relation[];
  facts: Record<string, Fact>;
}

export type Op =
  | { op: "move_entity"; id: string; to: string }
  | {
      op: "create_entity";
      id: string;
      kind: Kind;
      name: string;
      description: string;
      location?: string;
      exits?: string[];
    }
  | {
      op: "update_entity";
      id: string;
      description?: string;
      status?: Status;
      goal?: string;
      attributes?: Record<string, string>;
    }
  | { op: "set_relation"; from: string; rel: string; to: string; present: boolean }
  | { op: "share_fact"; fact_id: string; text?: string; to: string[] };

export type OpResult = { ok: true; summary: string } | { ok: false; error: string };

export const PLAYER = "player";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

const ID_RE = /^[a-z][a-z0-9_]{1,40}$/;

function need(world: World, id: string, label = "entity"): Entity | string {
  const e = world.entities[id];
  return e ?? `No ${label} with id "${id}". Known ids: ${Object.keys(world.entities).join(", ")}.`;
}

/** Where a character or item physically is (follows items held by characters). */
export function placeOf(world: World, id: string): string | undefined {
  let cur: Entity | undefined = world.entities[id];
  for (let i = 0; cur && i < 5; i++) {
    if (cur.kind === "place") return cur.id;
    cur = cur.location ? world.entities[cur.location] : undefined;
  }
  return undefined;
}

/**
 * Validate and apply one operation, mutating `world` only when it is valid.
 */
export function applyOp(world: World, op: Op): OpResult {
  switch (op.op) {
    case "move_entity": {
      const e = need(world, op.id);
      if (typeof e === "string") return { ok: false, error: e };
      const dest = need(world, op.to, "destination");
      if (typeof dest === "string") return { ok: false, error: dest };
      if (e.kind === "place") return { ok: false, error: `${e.name} is a place and cannot move.` };
      if (e.kind === "character") {
        if (e.status === "dead") return { ok: false, error: `${e.name} is dead and cannot move.` };
        if (dest.kind !== "place") return { ok: false, error: `Characters can only move to places.` };
        const from = e.location ? world.entities[e.location] : undefined;
        if (e.id === PLAYER && from && from.id !== dest.id && !(from.exits ?? []).includes(dest.id)) {
          return {
            ok: false,
            error: `${dest.name} is not reachable from ${from.name}. Exits: ${(from.exits ?? []).join(", ") || "none"}.`,
          };
        }
      }
      if (e.kind === "item") {
        if (dest.kind === "item") return { ok: false, error: `Items cannot be put inside other items.` };
        if (dest.kind === "character" && dest.status === "dead")
          return { ok: false, error: `${dest.name} is dead and cannot take items.` };
      }
      const prev = e.location;
      e.location = dest.id;
      return { ok: true, summary: `${e.name}: ${prev ?? "nowhere"} → ${dest.id}` };
    }

    case "create_entity": {
      if (!ID_RE.test(op.id)) return { ok: false, error: `Id "${op.id}" must be snake_case (a-z, 0-9, _).` };
      if (world.entities[op.id]) return { ok: false, error: `Id "${op.id}" already exists; use update_entity.` };
      if (op.kind !== "place") {
        if (!op.location) return { ok: false, error: `A ${op.kind} needs a location.` };
        const loc = need(world, op.location, "location");
        if (typeof loc === "string") return { ok: false, error: loc };
      }
      for (const x of op.exits ?? []) {
        const target = world.entities[x];
        if (!target || target.kind !== "place") return { ok: false, error: `Exit "${x}" is not a known place.` };
      }
      const e: Entity = {
        id: op.id,
        kind: op.kind,
        name: op.name,
        description: op.description,
        attributes: {},
      };
      if (op.kind === "place") {
        e.exits = [...(op.exits ?? [])];
        for (const x of e.exits) world.entities[x].exits = [...new Set([...(world.entities[x].exits ?? []), op.id])];
      } else {
        e.location = op.location;
      }
      if (op.kind === "character") e.status = "alive";
      world.entities[op.id] = e;
      return { ok: true, summary: `created ${op.kind} ${op.id}` };
    }

    case "update_entity": {
      const e = need(world, op.id);
      if (typeof e === "string") return { ok: false, error: e };
      if (op.status) {
        if (e.kind !== "character") return { ok: false, error: `Only characters have a status.` };
        if (e.status === "dead" && op.status !== "dead")
          return { ok: false, error: `${e.name} is dead. The dead do not come back in this world.` };
        if (e.id === PLAYER && op.status === "dead")
          return { ok: false, error: `The player cannot be killed by the game master; describe the danger instead.` };
      }
      if (op.goal && e.kind !== "character") return { ok: false, error: `Only characters have goals.` };
      const changed: string[] = [];
      if (op.description) (e.description = op.description), changed.push("description");
      if (op.status) (e.status = op.status), changed.push(`status=${op.status}`);
      if (op.goal) (e.goal = op.goal), changed.push("goal");
      for (const [k, v] of Object.entries(op.attributes ?? {})) {
        if (v === "") delete e.attributes[k];
        else e.attributes[k] = v;
        changed.push(k);
      }
      if (!changed.length) return { ok: false, error: `Nothing to update.` };
      return { ok: true, summary: `${e.id}: ${changed.join(", ")}` };
    }

    case "set_relation": {
      for (const id of [op.from, op.to]) {
        const e = need(world, id);
        if (typeof e === "string") return { ok: false, error: e };
      }
      if (op.from === op.to) return { ok: false, error: `A relation needs two different entities.` };
      const rel = op.rel.trim().toLowerCase();
      const idx = world.relations.findIndex((r) => r.from === op.from && r.to === op.to && r.rel === rel);
      if (op.present) {
        if (idx >= 0) return { ok: true, summary: `${op.from} ${rel} ${op.to} (already)` };
        world.relations.push({ from: op.from, rel, to: op.to });
        return { ok: true, summary: `${op.from} ${rel} ${op.to}` };
      }
      if (idx < 0) return { ok: false, error: `${op.from} does not have relation "${rel}" to ${op.to}.` };
      world.relations.splice(idx, 1);
      return { ok: true, summary: `${op.from} no longer ${rel} ${op.to}` };
    }

    case "share_fact": {
      let fact = world.facts[op.fact_id];
      if (!fact) {
        if (!op.text) return { ok: false, error: `Fact "${op.fact_id}" is new; include its text.` };
        if (!ID_RE.test(op.fact_id)) return { ok: false, error: `Fact id must be snake_case.` };
        fact = world.facts[op.fact_id] = { id: op.fact_id, text: op.text, knownBy: [] };
      }
      for (const id of op.to) {
        const c = world.entities[id];
        if (!c || c.kind !== "character") return { ok: false, error: `"${id}" is not a character.` };
        if (c.status === "dead") return { ok: false, error: `${c.name} is dead and cannot learn anything.` };
      }
      fact.knownBy = [...new Set([...fact.knownBy, ...op.to])];
      return { ok: true, summary: `${op.fact_id} known by ${op.to.join(", ")}` };
    }
  }
}

/**
 * Checks invariants over the whole world. Used in tests and after each turn as
 * a safety net; `applyOp` should make these impossible to break.
 */
export function checkInvariants(world: World): string[] {
  const problems: string[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.kind !== "place") {
      if (!e.location || !world.entities[e.location]) problems.push(`${e.id} has no valid location`);
      else if (e.kind === "character" && world.entities[e.location].kind !== "place")
        problems.push(`${e.id} is inside a non-place`);
      if (!placeOf(world, e.id)) problems.push(`${e.id} is not anchored to a place`);
    }
    for (const x of e.exits ?? []) {
      if (!world.entities[x]?.exits?.includes(e.id)) problems.push(`exit ${e.id}→${x} is one-way`);
    }
  }
  for (const r of world.relations) {
    if (!world.entities[r.from] || !world.entities[r.to]) problems.push(`dangling relation ${r.from} ${r.rel} ${r.to}`);
  }
  for (const f of Object.values(world.facts)) {
    for (const id of f.knownBy) if (!world.entities[id]) problems.push(`fact ${f.id} known by unknown ${id}`);
  }
  return problems;
}

/** A compact, model-friendly view of the world, centred on the player. */
export function describeForModel(world: World): string {
  const here = placeOf(world, PLAYER);
  const lines: string[] = [`TURN ${world.turn}. The player is at: ${here}.`, "", "ENTITIES"];
  for (const e of Object.values(world.entities)) {
    const bits = [`- ${e.id} [${e.kind}] "${e.name}": ${e.description}`];
    if (e.location) bits.push(`at=${e.location}`);
    if (e.exits) bits.push(`exits=${e.exits.join("|")}`);
    if (e.status) bits.push(`status=${e.status}`);
    if (e.goal) bits.push(`goal="${e.goal}"`);
    for (const [k, v] of Object.entries(e.attributes)) bits.push(`${k}=${v}`);
    lines.push(bits.join("; "));
  }
  lines.push("", "RELATIONS");
  for (const r of world.relations) lines.push(`- ${r.from} ${r.rel} ${r.to}`);
  lines.push("", "FACTS (secret unless the player is in knownBy)");
  for (const f of Object.values(world.facts)) lines.push(`- ${f.id}: ${f.text} [known by: ${f.knownBy.join(", ") || "nobody"}]`);
  return lines.join("\n");
}
