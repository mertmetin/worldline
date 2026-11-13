import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hasCredentials, runTurn } from "./gm";
import { Timeline } from "./timeline";

const PORT = Number(process.env.API_PORT ?? 8787);
const timeline = new Timeline(process.env.WORLDLINE_SAVE ?? "data/save.json");
let busy = false;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/timeline") {
      return send(res, 200, { ...timeline.data, mode: hasCredentials() && process.env.WORLDLINE_MOCK !== "1" ? "ai" : "offline" });
    }

    if (req.method === "POST" && req.url === "/api/turn") {
      const body = await readJson(req);
      const parentId = String(body.parentId ?? "");
      const action = String(body.action ?? "").trim().slice(0, 500);
      const parent = timeline.get(parentId);
      if (!parent) return send(res, 404, { error: "Unknown timeline node." });
      if (!action) return send(res, 400, { error: "Say what you do." });
      if (busy) return send(res, 409, { error: "The game master is still writing the last turn." });
      busy = true;
      try {
        const result = await runTurn(parent.world, timeline.history(parentId), action);
        const node = timeline.add(parentId, { action, ...result });
        return send(res, 200, node);
      } finally {
        busy = false;
      }
    }

    if (req.method === "POST" && req.url === "/api/reset") {
      timeline.reset();
      return send(res, 200, timeline.data);
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err instanceof Error ? err.message : "Server error" });
  }
}).listen(PORT, () => {
  console.log(`worldline api on http://localhost:${PORT} (${hasCredentials() ? "AI game master" : "offline mock mode"})`);
});
