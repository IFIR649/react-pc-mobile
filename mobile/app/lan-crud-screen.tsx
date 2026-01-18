import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { CameraView, useCameraPermissions } from "expo-camera";

// NOTA: por ahora dejamos mDNS fuera (porque react-native-zeroconf en Expo Go suele dar guerra).
// Dejamos QR + baseUrl guardada. En el siguiente paso te doy mDNS con Dev Client.

const STORE_KEY = "LAN_BASE_URL";

async function tryHealth(baseUrl: string) {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return !!data?.ok;
}

async function api(baseUrl: string, path: string, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data;
}

export default function LanCrudScreen(){
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Sin conexión (usa QR)");
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");

  const [qrOpen, setQrOpen] = useState(false);
  const [perm, requestPermission] = useCameraPermissions();

  const canAdd = useMemo(() => title.trim().length > 0, [title]);

  async function connectWithBaseUrl(url: string) {
    setStatus("Probando conexión...");
    const ok = await tryHealth(url);
    if (!ok) {
      setStatus("No se pudo conectar.");
      throw new Error("No responde /health (¿misma red? ¿firewall?)");
    }
    await SecureStore.setItemAsync(STORE_KEY, url);
    setBaseUrl(url);
    setStatus("Conectado ✅");
  }

  async function connectFromSaved() {
    const saved = await SecureStore.getItemAsync(STORE_KEY);
    if (!saved) return;
    try {
      await connectWithBaseUrl(saved);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setStatus("Guardada falló (usa QR)");
    }
  }

  async function load() {
    if (!baseUrl) return;
    setErr("");
    try {
      const rows = await api(baseUrl, "/items");
      setItems(rows);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    connectFromSaved();
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
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function del(item: any) {
    if (!baseUrl) return;
    Alert.alert("Eliminar", `¿Eliminar #${item.id}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await api(baseUrl, `/items/${item.id}`, { method: "DELETE" });
            await load();
          } catch (e: any) {
            setErr(String(e?.message || e));
          }
        },
      },
    ]);
  }

  async function openQr() {
    if (!perm?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert("Permiso requerido", "Necesito permiso de cámara para escanear QR.");
        return;
      }
    }
    setQrOpen(true);
  }

  async function onQrData(data: string) {
    try {
      const parsed = JSON.parse(data);
      const url = String(parsed?.baseUrl || "").trim();
      if (!url.startsWith("http")) throw new Error("QR inválido (sin baseUrl)");
      setQrOpen(false);
      await connectWithBaseUrl(url);
    } catch (e: any) {
      Alert.alert("QR inválido", String(e?.message || e));
    }
  }

  return (
  <SafeAreaView style={{ flex: 1, backgroundColor: "#000", padding: 16 }}>
    <Text style={{ fontSize: 20, fontWeight: "700", color: "#fff" }}>RN LAN CRUD</Text>
    <Text style={{ opacity: 0.8, marginTop: 6, color: "#fff" }}>{status}</Text>
    <Text style={{ opacity: 0.7, marginTop: 4, color: "#fff" }}>
      {baseUrl ? `API: ${baseUrl}` : "API: (no conectada)"}
    </Text>

    {err ? <Text style={{ color: "#ff4d4d", marginTop: 10 }}>{err}</Text> : null}

    <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
      <Pressable
        onPress={openQr}
        style={{ padding: 10, borderWidth: 1, borderRadius: 12, borderColor: "#fff" }}
      >
        <Text style={{ color: "#fff" }}>Escanear QR</Text>
      </Pressable>

      <Pressable
        onPress={async () => {
          await SecureStore.deleteItemAsync(STORE_KEY);
          setBaseUrl(null);
          setStatus("BaseUrl borrada. Usa QR.");
        }}
        style={{ padding: 10, borderWidth: 1, borderRadius: 12, borderColor: "#fff" }}
      >
        <Text style={{ color: "#fff" }}>Olvidar</Text>
      </Pressable>

      <Pressable
        onPress={load}
        style={{ padding: 10, borderWidth: 1, borderRadius: 12, borderColor: "#fff" }}
      >
        <Text style={{ color: "#fff" }}>Refrescar</Text>
      </Pressable>
    </View>

    <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Nueva nota..."
        placeholderTextColor="#999"
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: "#fff",
          color: "#fff",
          paddingHorizontal: 10,
          paddingVertical: 10,
          borderRadius: 10,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      />
      <Pressable
        onPress={add}
        disabled={!baseUrl || !canAdd}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 10,
          opacity: baseUrl && canAdd ? 1 : 0.35,
          borderWidth: 1,
          borderColor: "#fff",
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      >
        <Text style={{ color: "#fff" }}>Agregar</Text>
      </Pressable>
    </View>

    <FlatList
      style={{ marginTop: 14 }}
      data={items}
      keyExtractor={(it) => String(it.id)}
      renderItem={({ item }) => (
        <View
          style={{
            padding: 12,
            borderWidth: 1,
            borderColor: "#fff",
            borderRadius: 12,
            marginBottom: 10,
            backgroundColor: "rgba(255,255,255,0.04)",
          }}
        >
          <Text style={{ fontWeight: "700", color: "#fff" }}>#{item.id}</Text>
          <Text style={{ marginTop: 4, color: "#fff" }}>{item.title}</Text>
          <Text style={{ opacity: 0.7, marginTop: 4, fontSize: 12, color: "#fff" }}>
            {item.updated_at}
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pressable
              onPress={() => del(item)}
              style={{ padding: 8, borderWidth: 1, borderRadius: 10, borderColor: "#fff" }}
            >
              <Text style={{ color: "#fff" }}>Eliminar</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  </SafeAreaView>
);

}
