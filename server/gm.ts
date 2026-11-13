import Anthropic from "@anthropic-ai/sdk";
import { applyOp, clone, describeForModel, placeOf, PLAYER, type Op, type World } from "./world";

export interface TraceStep {
  tool: string;
  input: unknown;
  ok: boolean;
  result: string;
}

export interface TurnResult {
  world: World;
  narration: string;
  offscreen: string[];
  trace: TraceStep[];
  usage: { input: number; output: number; requests: number };
  model: string;
}

export interface StoryBeat {
  action: string;
  narration: string;
}

const MODEL = process.env.WORLDLINE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.WORLDLINE_EFFORT ?? "low") as "low" | "medium" | "high";
const MAX_STEPS = 10;

const SYSTEM = `You are the game master of a text adventure. The world is stored as a graph that you can only change through tools. The graph is the truth: if your story and the graph disagree, the graph wins.

Each turn:
1. Read the world state and the player's action.
2. Decide what happens. Respect the rules: the player can only walk to adjacent places; dead characters stay dead; an item is in exactly one place or held by one character; characters only know the facts listed for them.
3. Record every change with tools BEFORE you narrate it: movements, items changing hands, moods, new relations, facts that someone learns. If the player learns a secret, call share_fact with "player" in "to".
4. NPCs have goals and act on them even when the player isn't watching. Each turn, consider whether one or two NPCs make an off-screen move toward their goal; if so, apply it with tools and log it with note_offscreen. Keep it plausible and small.
5. If a tool call is rejected, read the reason and fix your plan. Never narrate a change that was rejected.
6. Finish with the narration only: second person, present tense, 60-140 words, vivid but plain. Mention only what the player can perceive. End with something to react to. No headings, no lists, no meta commentary.

The player may try anything. Let them, and make the world push back in ways that follow from the state.`;

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "move_entity",
    description:
      "Move a character to a place, or an item to a place or into a character's possession. The player can only move to a place connected to their current place.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Entity id to move." },
        to: { type: "string", description: "Destination place id, or character id when handing over an item." },
      },
      required: ["id", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "create_entity",
    description:
      "Add something new the story needs (a hidden room, a stranger, an object found in a drawer). Places take exits; characters and items take a location.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "New unique snake_case id." },
        kind: { type: "string", enum: ["place", "character", "item"] },
        name: { type: "string" },
        description: { type: "string" },
        location: { type: "string", description: "For characters and items." },
        exits: { type: "array", items: { type: "string" }, description: "For places: ids of connected places." },
      },
      required: ["id", "kind", "name", "description"],
      additionalProperties: false,
    },
  },
  {
    name: "update_entity",
    description:
      "Change an entity's description, a character's status (alive, dead, missing) or goal, or attributes such as mood. Set an attribute to an empty string to remove it.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["alive", "dead", "missing"] },
        goal: { type: "string" },
        attributes: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_relation",
    description: 'Add or remove a relation between two entities, e.g. "trusts", "owes", "fears", "hunting".',
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        rel: { type: "string" },
        to: { type: "string" },
        present: { type: "boolean", description: "true to add, false to remove." },
      },
      required: ["from", "rel", "to", "present"],
      additionalProperties: false,
    },
  },
  {
    name: "share_fact",
    description:
      "Make characters learn a fact. Use an existing fact id to spread a secret, or a new id plus text for new information.",
    input_schema: {
      type: "object",
      properties: {
        fact_id: { type: "string" },
        text: { type: "string", description: "Required only when the fact is new." },
        to: { type: "array", items: { type: "string" }, description: "Character ids who now know it." },
      },
      required: ["fact_id", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "note_offscreen",
    description: "Log an NPC action that happened out of the player's sight this turn (after applying its changes).",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

let client: Anthropic | null = null;

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function runTurn(prev: World, history: StoryBeat[], action: string): Promise<TurnResult> {
  if (process.env.WORLDLINE_MOCK === "1" || !hasCredentials()) return mockTurn(prev, action);
  client ??= new Anthropic();

  const world = clone(prev);
  world.turn += 1;
  const trace: TraceStep[] = [];
  const offscreen: string[] = [];
  const usage = { input: 0, output: 0, requests: 0 };

  const recent = history
    .slice(-6)
    .map((b) => `> ${b.action}\n${b.narration}`)
    .join("\n\n");

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `# ${world.title}\n${world.premise}\n\n# World state\n${describeForModel(world)}\n\n# Story so far (most recent last)\n${recent || "(the story begins)"}\n\n# Player action\n${action}`,
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools,
      messages,
      output_config: { effort: EFFORT },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.requests += 1;

    if (response.stop_reason === "refusal") {
      return { world: prev, narration: "The fog thickens and the moment passes. (The game master declined that action.)", offscreen, trace, usage, model: response.model };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const narration = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { world, narration: narration || "Nothing seems to happen.", offscreen, trace, usage, model: response.model };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      const input = use.input as Record<string, unknown>;
      let ok: boolean;
      let text: string;
      if (use.name === "note_offscreen") {
        ok = typeof input.text === "string" && input.text.length > 0;
        text = ok ? "logged" : "text is required";
        if (ok) offscreen.push(String(input.text));
      } else {
        const r = applyOp(world, { op: use.name, ...input } as Op);
        ok = r.ok;
        text = r.ok ? r.summary : r.error;
      }
      trace.push({ tool: use.name, input, ok, result: text });
      return { type: "tool_result", tool_use_id: use.id, content: text, is_error: !ok };
    });
    messages.push({ role: "user", content: results });
  }

  return { world, narration: "Time seems to stutter. (The game master ran out of steps this turn.)", offscreen, trace, usage, model: MODEL };
}

/**
 * A tiny rule-based stand-in used when no API credentials are set, so the UI,
 * timeline and tests work offline. It understands "go to <place>" and
 * "take <item>"; everything else gets a neutral description.
 */
export function mockTurn(prev: World, action: string): TurnResult {
  const world = clone(prev);
  world.turn += 1;
  const trace: TraceStep[] = [];
  const lower = action.toLowerCase();
  const here = placeOf(world, PLAYER)!;
  const find = (kind: string) =>
    Object.values(world.entities).find(
      (e) => e.kind === kind && (lower.includes(e.id.replace(/_/g, " ")) || lower.includes(e.name.toLowerCase())),
    );

  let narration = `You ${lower.replace(/^i /, "")}. ${world.entities[here].description}`;
  const place = /\b(go|walk|head|run)\b/.test(lower) ? find("place") : undefined;
  const item = /\b(take|grab|pick)\b/.test(lower) ? find("item") : undefined;
  const op: Op | undefined = place
    ? { op: "move_entity", id: PLAYER, to: place.id }
    : item
      ? { op: "move_entity", id: item.id, to: PLAYER }
      : undefined;

  if (op) {
    if (item && placeOf(world, item.id) !== here) {
      trace.push({ tool: op.op, input: op, ok: false, result: `${item.name} is not here.` });
      narration = `You look around for the ${item.name.toLowerCase()}, but it isn't here.`;
    } else {
      const r = applyOp(world, op);
      trace.push({ tool: op.op, input: op, ok: r.ok, result: r.ok ? r.summary : r.error });
      if (r.ok && place) narration = `You make your way to ${place.name}. ${place.description}`;
      else if (r.ok && item) narration = `You take the ${item.name.toLowerCase()}. ${item.description}`;
      else if (!r.ok) narration = `You can't go that way. (${r.error})`;
    }
  }
  return {
    world,
    narration: `${narration}\n\n(Offline mode: set ANTHROPIC_API_KEY for the AI game master.)`,
    offscreen: [],
    trace,
    usage: { input: 0, output: 0, requests: 0 },
    model: "mock",
  };
}
