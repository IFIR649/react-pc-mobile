import { useEffect, useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4310";

async function api(base, path, options) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);

  const [serverInfo, setServerInfo] = useState(null);
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const canAdd = useMemo(() => title.trim().length > 0, [title]);

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const rows = await api(apiBase, "/items");
      setItems(rows);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function loadServerInfo() {
    try {
      // si el web corre en la misma PC, localhost sirve
      const info = await api("http://localhost:4310", "/server-info");
      setServerInfo(info);
      // si tu VITE_API_BASE es localhost, te sugiero seleccionar la primera URL LAN para QR
      if (DEFAULT_API_BASE.includes("localhost") && info?.urls?.[0]) {
        // NO forzamos, solo dejamos opciones
      }
    } catch {
      // si no hay server en localhost, ignora
    }
  }

  useEffect(() => {
    load();
    loadServerInfo();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  async function add() {
    if (!canAdd) return;
    setErr("");
    try {
      await api(apiBase, "/items", { method: "POST", body: JSON.stringify({ title }) });
      setTitle("");
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function edit(id) {
    const current = items.find((x) => x.id === id);
    const next = prompt("Nuevo titulo:", current?.title ?? "");
    if (next == null) return;
    const t = next.trim();
    if (!t) return;

    setErr("");
    try {
      await api(apiBase, `/items/${id}`, { method: "PUT", body: JSON.stringify({ title: t }) });
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function del(id) {
    if (!confirm("Eliminar?")) return;
    setErr("");
    try {
      await api(apiBase, `/items/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  const qrPayload = JSON.stringify({
    baseUrl: apiBase,
    token: "demo-token", // luego lo volvemos real si quieres
    ts: Date.now(),
  });

  return (
    <div style={{ maxWidth: 820, margin: "28px auto", fontFamily: "system-ui" }}>
      <h2>LAN CRUD Demo (PC + Telefono)</h2>

      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: 12,
          border: "1px solid #eee",
          borderRadius: 12,
        }}
      >
        <div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>API actual</div>
          <div style={{ fontWeight: 700 }}>{apiBase}</div>

          {serverInfo?.urls?.length ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ opacity: 0.7, fontSize: 12 }}>URLs LAN detectadas (para QR / fallback)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {serverInfo.urls.map((u) => (
                  <button key={u} onClick={() => setApiBase(u)} style={{ padding: "6px 10px", borderRadius: 10 }}>
                    Usar {u}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 10 }}>
              (Si no aparecen URLs LAN, asegurate de que el server este corriendo en la PC en localhost:4310)
            </div>
          )}
        </div>

        <div style={{ marginLeft: "auto", textAlign: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>QR (fallback)</div>
          <QRCodeCanvas value={qrPayload} size={140} />
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Escanealo con la app RN</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nueva nota..."
          style={{ flex: 1, padding: 10 }}
        />
        <button onClick={add} disabled={!canAdd} style={{ padding: "10px 14px" }}>
          Agregar
        </button>
        <button onClick={load} style={{ padding: "10px 14px" }}>
          Refrescar
        </button>
      </div>

      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {loading && <p>Cargando...</p>}

      <ul style={{ marginTop: 16, paddingLeft: 18 }}>
        {items.map((it) => (
          <li key={it.id} style={{ marginBottom: 10 }}>
            <b>#{it.id}</b> {it.title}{" "}
            <span style={{ opacity: 0.6, fontSize: 12 }}>({it.updated_at})</span>
            <div style={{ display: "inline-flex", gap: 8, marginLeft: 8 }}>
              <button onClick={() => edit(it.id)}>Editar</button>
              <button onClick={() => del(it.id)}>Eliminar</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
