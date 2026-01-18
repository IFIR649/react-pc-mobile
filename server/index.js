const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const os = require("os");
const { Bonjour } = require("bonjour-service");

const PORT = process.env.PORT || 4310;
const HOST = "0.0.0.0";

// Nombre del servicio (lo vera RN via Zeroconf)
const SERVICE_NAME = "Ivadent Server";
const SERVICE_TYPE = "ivadent"; // -> _ivadent._tcp.local

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("demo.db");

// 1 tabla: items
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function nowIso() {
  return new Date().toISOString();
}

function getLanIPv4() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      // IPv4, no interna
      if (n.family === "IPv4" && !n.internal) {
        ips.push(n.address);
      }
    }
  }
  // quita duplicados
  return [...new Set(ips)];
}

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true, time: nowIso() }));

// Info para web QR (sin que tu busques IP)
app.get("/server-info", (_req, res) => {
  const ips = getLanIPv4();
  const urls = ips.map((ip) => `http://${ip}:${PORT}`);
  res.json({
    ok: true,
    name: SERVICE_NAME,
    type: SERVICE_TYPE,
    port: PORT,
    urls,
    time: nowIso(),
  });
});

// LIST
app.get("/items", (_req, res) => {
  const rows = db.prepare("SELECT id, title, updated_at FROM items ORDER BY id DESC").all();
  res.json(rows);
});

// CREATE
app.post("/items", (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title requerido" });

  const stmt = db.prepare("INSERT INTO items (title, updated_at) VALUES (?, ?)");
  const info = stmt.run(title, nowIso());
  const row = db.prepare("SELECT id, title, updated_at FROM items WHERE id=?").get(info.lastInsertRowid);
  res.status(201).json(row);
});

// UPDATE
app.put("/items/:id", (req, res) => {
  const id = Number(req.params.id);
  const title = String(req.body?.title ?? "").trim();
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "id invalido" });
  if (!title) return res.status(400).json({ error: "title requerido" });

  const existing = db.prepare("SELECT id FROM items WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "no encontrado" });

  db.prepare("UPDATE items SET title=?, updated_at=? WHERE id=?").run(title, nowIso(), id);
  const row = db.prepare("SELECT id, title, updated_at FROM items WHERE id=?").get(id);
  res.json(row);
});

// DELETE
app.delete("/items/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "id invalido" });

  const info = db.prepare("DELETE FROM items WHERE id=?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "no encontrado" });

  res.json({ ok: true });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Server LAN escuchando en http://${HOST}:${PORT}`);
  console.log(`IPs LAN detectadas:`, getLanIPv4().map((ip) => `http://${ip}:${PORT}`));
});

// mDNS publish
const bonjour = new Bonjour();
bonjour.publish({
  name: SERVICE_NAME,
  type: SERVICE_TYPE,
  port: PORT,
  txt: { app: "lan-crud-demo", v: "1" },
});

process.on("SIGINT", () => {
  bonjour.unpublishAll(() => {
    bonjour.destroy();
    server.close(() => process.exit(0));
  });
});
