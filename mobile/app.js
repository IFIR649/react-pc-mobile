import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, SafeAreaView, Text, TextInput, View, Modal } from "react-native";
import * as SecureStore from "expo-secure-store";
import { BarCodeScanner } from "expo-barcode-scanner";
import Zeroconf from "react-native-zeroconf";

const STORE_KEY = "LAN_BASE_URL";
const SERVICE_TYPE = "ivadent"; // debe coincidir con server: type: "ivadent"
const DEFAULT_PORT = 4310;

async function tryHealth(baseUrl) {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return !!data?.ok;
}

async function api(baseUrl, path, options) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(null);
  const [status, setStatus] = useState("Buscando server...");
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");

  const [qrOpen, setQrOpen] = useState(false);
  const [hasCamPerm, setHasCamPerm] = useState(null);

  const canAdd = useMemo(() => title.trim().length > 0, [title]);

  async function load() {
    if (!baseUrl) return;
    setErr("");
    try {
      const rows = await api(baseUrl, "/items");
      setItems(rows);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function connectWithBaseUrl(url) {
    setStatus("Probando conexion...");
    const ok = await tryHealth(url);
    if (!ok) {
      setStatus("No se pudo conectar.");
      throw new Error("No responde /health (misma red? firewall?)");
    }
    await SecureStore.setItemAsync(STORE_KEY, url);
    setBaseUrl(url);
    setStatus("Conectado");
  }

  async function connectFromSaved() {
    const saved = await SecureStore.getItemAsync(STORE_KEY);
    if (saved) {
      try {
        await connectWithBaseUrl(saved);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function startZeroconfDiscovery() {
    const zeroconf = new Zeroconf();
    setStatus("Buscando por mDNS (Zeroconf)...");
    zeroconf.scan(SERVICE_TYPE, "tcp");

    zeroconf.on("resolved", async (service) => {
      try {
        // service.addresses suele traer varias IPs
        const ip = service?.addresses?.find((x) => typeof x === "string" && x.includes("."));
        const port = service?.port || DEFAULT_PORT;
        if (!ip) return;

        const url = `http://${ip}:${port}`;
        await connectWithBaseUrl(url);
        zeroconf.stop();
      } catch (e) {
        // Si falla, seguimos buscando
        setErr(String(e.message || e));
      }
    });

    zeroconf.on("error", (e) => {
      setStatus("Zeroconf error (usa QR)");
      setErr(String(e?.message || e));
    });

    // si no resolvio en 6s, sugerimos QR
    setTimeout(() => {
      if (!baseUrl) setStatus("No se encontro por mDNS. Usa QR (fallback).");
    }, 6000);

    return () => {
      try {
        zeroconf.stop();
      } catch {}
    };
  }

  useEffect(() => {
    (async () => {
      // 1) intenta baseUrl guardada
      const okSaved = await connectFromSaved();
      if (okSaved) return;

      // 2) si no, intenta mDNS
      const stop = startZeroconfDiscovery();
      return stop;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!baseUrl) return;
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [baseUrl]);

  async function add() {
    if (!baseUrl || !canAdd) return;
    try {
      await api(baseUrl, "/items", { method: "POST", body: JSON.stringify({ title }) });
      setTitle("");
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function del(item) {
    if (!baseUrl) return;
    Alert.alert("Eliminar", `Eliminar #${item.id}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await api(baseUrl, `/items/${item.id}`, { method: "DELETE" });
            await load();
          } catch (e) {
            setErr(String(e.message || e));
          }
        },
      },
    ]);
  }

  async function openQr() {
    if (hasCamPerm == null) {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasCamPerm(status === "granted");
    }
    setQrOpen(true);
  }

  async function onQrScanned({ data }) {
    try {
      // data debe ser JSON: {"baseUrl":"http://x.x.x.x:4310", ...}
      const parsed = JSON.parse(data);
      const url = String(parsed?.baseUrl || "").trim();
      if (!url.startsWith("http")) throw new Error("QR invalido (sin baseUrl)");
      setQrOpen(false);
      await connectWithBaseUrl(url);
    } catch (e) {
      Alert.alert("QR invalido", String(e.message || e));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700" }}>RN LAN CRUD</Text>
      <Text style={{ opacity: 0.7, marginTop: 6 }}>{status}</Text>
      <Text style={{ opacity: 0.6, marginTop: 4 }}>{baseUrl ? `API: ${baseUrl}` : "API: (no conectada)"}</Text>

      {err ? <Text style={{ color: "crimson", marginTop: 10 }}>{err}</Text> : null}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Pressable onPress={() => startZeroconfDiscovery()} style={{ padding: 10, borderWidth: 1, borderRadius: 12 }}>
          <Text>Reintentar mDNS</Text>
        </Pressable>
        <Pressable onPress={openQr} style={{ padding: 10, borderWidth: 1, borderRadius: 12 }}>
          <Text>Escanear QR</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            await SecureStore.deleteItemAsync(STORE_KEY);
            setBaseUrl(null);
            setStatus("BaseUrl borrada. Busca de nuevo.");
          }}
          style={{ padding: 10, borderWidth: 1, borderRadius: 12 }}
        >
          <Text>Olvidar</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Nueva nota..."
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: "#ddd",
            paddingHorizontal: 10,
            paddingVertical: 10,
            borderRadius: 10,
          }}
        />
        <Pressable
          onPress={add}
          disabled={!baseUrl || !canAdd}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            opacity: baseUrl && canAdd ? 1 : 0.4,
            borderWidth: 1,
            borderColor: "#111",
          }}
        >
          <Text>Agregar</Text>
        </Pressable>
      </View>

      <FlatList
        style={{ marginTop: 14 }}
        data={items}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderWidth: 1, borderColor: "#eee", borderRadius: 12, marginBottom: 10 }}>
            <Text style={{ fontWeight: "700" }}>#{item.id}</Text>
            <Text style={{ marginTop: 4 }}>{item.title}</Text>
            <Text style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>{item.updated_at}</Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable onPress={() => del(item)} style={{ padding: 8, borderWidth: 1, borderRadius: 10 }}>
                <Text>Eliminar</Text>
              </Pressable>
              <Pressable onPress={load} style={{ padding: 8, borderWidth: 1, borderRadius: 10 }}>
                <Text>Refrescar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Modal visible={qrOpen} animationType="slide">
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "700" }}>Escanea el QR de la PC</Text>
            <Pressable onPress={() => setQrOpen(false)} style={{ padding: 10, borderWidth: 1, borderRadius: 10 }}>
              <Text>Cerrar</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1 }}>
            <BarCodeScanner onBarCodeScanned={onQrScanned} style={{ flex: 1 }} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
