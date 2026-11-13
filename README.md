# Worldline

An AI game master whose world remembers. You can type anything, and the story branches for real. Every turn is saved as a node in a timeline tree, so you can rewind to any moment and try something else.

The game master is Claude, but Claude never edits the world directly. It proposes changes through tools; a deterministic checker validates each one against a **world graph** of places, characters, items, relations and secrets, and rejects anything that contradicts it. The model reads the rejection, fixes its plan, and only then narrates.

## What it shows

- **A world graph as the source of truth.** Places with exits, characters with goals and moods, items that sit in exactly one place or one pocket, relations ("distrusts", "owes"), and facts with a list of who knows them.
- **A validated tool loop.** `move_entity`, `create_entity`, `update_entity`, `set_relation` and `share_fact` go through `applyOp`, which enforces the rules: you can only walk to adjacent places, the dead stay dead, items can't be in two places, characters can only learn facts if they are alive. Rejected calls go back to the model as `is_error` tool results with a reason.
- **NPCs who act off screen.** Each turn the game master may move one or two NPCs toward their goals, logged as "meanwhile, out of sight" events.
- **Branching timelines.** Each turn stores a full snapshot of the world. Rewinding just selects an older node, and acting from it creates a sibling branch. Nothing is overwritten.
- **Measured consistency.** The header counts world edits, changes the checker rejected, and invariant violations found after each turn (which should stay at 0). Every turn has a "behind the scenes" trace of its tool calls.

## Run it

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY
npm run dev            # http://localhost:5180
```

Without an API key it runs in **offline mode**: a small rule-based stand-in handles "go to …" and "take …", so the UI, the timeline and the checker can be tried without spending tokens.

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables the AI game master |
| `WORLDLINE_MODEL` | `claude-opus-5-5` | Any Claude model id |
| `WORLDLINE_EFFORT` | `low` | `low`, `medium` or `high`; higher is slower and richer |
| `API_PORT` | `8787` | API server port (the Vite dev server proxies `/api`) |

## How a turn works

```
player action
     │
     ▼
world snapshot + recent story ──► Claude (tools: move, create, update, relate, share_fact, note_offscreen)
                                     │  proposes a change
                                     ▼
                                applyOp(world, op) ── rejected ──► is_error + reason ──► back to Claude
                                     │ ok
                                     ▼
                              change applied to the draft world
                                     │  …repeat until Claude narrates
                                     ▼
              checkInvariants(world) → new timeline node {action, narration, trace, world}
```

Each request is stateless: the model gets the current snapshot and the last few story beats on that branch, not a growing chat log. That keeps branches independent and the token cost per turn flat.

## Project layout

```
server/world.ts     world types, applyOp (the checker), checkInvariants, model-facing description
server/seed.ts      the starting world: Hollowmere, a fog-bound village with a missing bell
server/gm.ts        the Claude tool loop, plus the offline mock
server/timeline.ts  branching save file (data/save.json)
server/index.ts     tiny HTTP API: GET /api/timeline, POST /api/turn, POST /api/reset
src/                React UI: story, world graph (d3-force), timeline tree
test/               node:test suite for the rules and branching
```

## Tests

```bash
npm test        # rules engine + timeline
npm run typecheck
```

## Roadmap

- Replay mode: ship a recorded session so the hosted demo needs no API key
- Consistency eval: scripted playthroughs that score contradictions per 100 turns, with and without the checker
- NPC turns run by a cheaper model in parallel with the narrator
- Bring-your-own world: load a seed from JSON

## License

MIT
