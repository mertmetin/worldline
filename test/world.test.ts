import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOp, checkInvariants, placeOf } from "../server/world";
import { seedWorld } from "../server/seed";
import { mockTurn } from "../server/gm";
import { Timeline } from "../server/timeline";

test("seed world satisfies every invariant", () => {
  assert.deepEqual(checkInvariants(seedWorld()), []);
});

test("player can only walk to adjacent places", () => {
  const w = seedWorld();
  assert.equal(applyOp(w, { op: "move_entity", id: "player", to: "mill" }).ok, false);
  assert.equal(applyOp(w, { op: "move_entity", id: "player", to: "mill_road" }).ok, true);
  assert.equal(applyOp(w, { op: "move_entity", id: "player", to: "mill" }).ok, true);
  assert.equal(placeOf(w, "player"), "mill");
});

test("the dead stay dead and cannot act", () => {
  const w = seedWorld();
  assert.equal(applyOp(w, { op: "update_entity", id: "calder", status: "dead" }).ok, true);
  assert.equal(applyOp(w, { op: "update_entity", id: "calder", status: "alive" }).ok, false);
  assert.equal(applyOp(w, { op: "move_entity", id: "calder", to: "square" }).ok, false);
  assert.equal(applyOp(w, { op: "share_fact", fact_id: "sefa_lore", to: ["calder"] }).ok, false);
});

test("an item is in exactly one place and follows its holder", () => {
  const w = seedWorld();
  assert.equal(placeOf(w, "mill_key"), "mill"); // held by Wren, who is at the mill
  assert.equal(applyOp(w, { op: "move_entity", id: "mill_key", to: "player" }).ok, true);
  assert.equal(placeOf(w, "mill_key"), "square");
  assert.equal(applyOp(w, { op: "move_entity", id: "mill_key", to: "lantern" }).ok, false);
});

test("rejections leave the world untouched", () => {
  const w = seedWorld();
  const before = JSON.stringify(w);
  for (const op of [
    { op: "move_entity", id: "ghost", to: "square" },
    { op: "create_entity", id: "square", kind: "place", name: "Dup", description: "" },
    { op: "create_entity", id: "Bad Id", kind: "item", name: "x", description: "", location: "square" },
    { op: "set_relation", from: "ida", rel: "loves", to: "nobody", present: true },
    { op: "update_entity", id: "player", status: "dead" },
  ] as const) {
    assert.equal(applyOp(w, op).ok, false, JSON.stringify(op));
  }
  assert.equal(JSON.stringify(w), before);
});

test("new places get two-way exits", () => {
  const w = seedWorld();
  assert.equal(
    applyOp(w, { op: "create_entity", id: "crypt", kind: "place", name: "Crypt", description: "Damp.", exits: ["chapel"] }).ok,
    true,
  );
  assert.ok(w.entities.chapel.exits?.includes("crypt"));
  assert.deepEqual(checkInvariants(w), []);
});

test("timeline branches without overwriting", () => {
  const tl = new Timeline(join(mkdtempSync(join(tmpdir(), "worldline-")), "save.json"));
  const root = tl.data.rootId;
  const a = tl.add(root, { action: "go to the tavern", ...mockTurn(tl.get(root)!.world, "go to the tavern") });
  const b = tl.add(root, { action: "go to the chapel", ...mockTurn(tl.get(root)!.world, "go to the chapel") });
  assert.equal(placeOf(a.world, "player"), "tavern");
  assert.equal(placeOf(b.world, "player"), "chapel");
  assert.equal(placeOf(tl.get(root)!.world, "player"), "square");
  assert.deepEqual(tl.path(b.id).map((n) => n.id), [root, b.id]);
  assert.deepEqual(a.violations, []);
});
