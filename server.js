const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "AR Games Relay", version: "0.1.0" }));

const rooms = new Map();

function room(code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(code, obj, except = null) {
  const clients = rooms.get(code);
  if (!clients) return;
  for (const client of clients) if (client !== except) send(client, obj);
}
function cleanup(ws) {
  if (!ws.room) return;
  const clients = rooms.get(ws.room);
  if (!clients) return;
  clients.delete(ws);
  broadcast(ws.room, { type: "presence", event: "left", role: ws.role || "unknown" });
  if (clients.size === 0) rooms.delete(ws.room);
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => ws.isAlive = true);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: "error", message: "invalid_json" }); }

    if (msg.type === "join") {
      cleanup(ws);
      const code = String(msg.room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (code.length < 4) return send(ws, { type: "error", message: "room_required" });
      ws.room = code;
      ws.role = String(msg.role || "player").slice(0, 20);
      room(code).add(ws);
      send(ws, { type: "joined", room: code, role: ws.role });
      broadcast(code, { type: "presence", event: "joined", role: ws.role }, ws);
      return;
    }

    if (!ws.room) return send(ws, { type: "error", message: "join_first" });

    if (msg.type === "button") {
      const event = {
        type: "button",
        button: String(msg.button || "").slice(0, 30),
        role: ws.role,
        ts: Date.now()
      };
      broadcast(ws.room, event, ws);
      send(ws, { type: "ack", ts: event.ts });
    }
  });

  ws.on("close", () => cleanup(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`AR Games Relay v0.1 listening on ${PORT}`));
