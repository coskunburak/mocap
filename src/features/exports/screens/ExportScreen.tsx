// src/features/exports/screens/ExportScreen.tsx
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView } from "react-native";

import type { TakeId } from "../../../domain/mocap/models/Take";
import { TakeExporter, type ExportFormat } from "../../../domain/mocap/pipeline/export/TakeExporter";

type FormatBtnProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

function FormatButton({ label, active, onPress }: FormatBtnProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
      accessibilityRole="button"
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function ExportScreen() {
  const [takeId, setTakeId] = useState<string>("");
  const [format, setFormat] = useState<ExportFormat>("both");
  const [busy, setBusy] = useState(false);

  const [jsonPath, setJsonPath] = useState<string | undefined>();
  const [bvhPath, setBvhPath] = useState<string | undefined>();
  const [exportDir, setExportDir] = useState<string | undefined>();

  const canExport = useMemo(() => takeId.trim().length > 0 && !busy, [takeId, busy]);

  const onExport = async () => {
    const id = takeId.trim() as TakeId;
    if (!id) return;

    setBusy(true);
    setJsonPath(undefined);
    setBvhPath(undefined);
    setExportDir(undefined);

    try {
      // Optional: meta fetch to validate take exists early
      await TakeExporter.getTakeMeta(id);

      const res = await TakeExporter.exportTake(id, {
        format,
        filenamePrefix: `take_${id}`,
        includeFramesInJson: true,
        // bvhFps: 30, // istersen sabitle
      });

      setJsonPath(res.jsonPath);
      setBvhPath(res.bvhPath);
      setExportDir(res.exportDir);

      Alert.alert("Export hazır", "Dosyalar oluşturuldu.");
    } catch (e: any) {
      Alert.alert("Export hata", e?.message ?? "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const onShare = async (path?: string) => {
    if (!path) return;
    try {
      const res = await TakeExporter.shareFile(path);
      if (!res.shared) Alert.alert("Paylaşım yok", "Bu cihazda paylaşım desteklenmiyor.");
    } catch (e: any) {
      Alert.alert("Share hata", e?.message ?? "Share failed");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Export</Text>
      <Text style={styles.sub}>
        TakeId gir → format seç → export et → dosyayı paylaş.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Take ID</Text>
        <TextInput
          value={takeId}
          onChangeText={setTakeId}
          placeholder="örn: 1735970000-ab12cd"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Text style={[styles.label, { marginTop: 10 }]}>Format</Text>
        <View style={styles.row}>
          <FormatButton label="JSON" active={format === "json"} onPress={() => setFormat("json")} />
          <FormatButton label="BVH" active={format === "bvh"} onPress={() => setFormat("bvh")} />
          <FormatButton label="BOTH" active={format === "both"} onPress={() => setFormat("both")} />
        </View>

        <TouchableOpacity
          style={[styles.btn, !canExport && styles.btnDisabled]}
          disabled={!canExport}
          onPress={onExport}
        >
          <Text style={styles.btnText}>{busy ? "Exporting..." : "Export"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Output</Text>

        {!!exportDir && (
          <Text style={styles.path}>
            exportDir: {exportDir}
          </Text>
        )}

        {!!jsonPath && (
          <View style={styles.outRow}>
            <Text style={styles.path} numberOfLines={2}>JSON: {jsonPath}</Text>
            <TouchableOpacity style={styles.smallBtn} onPress={() => onShare(jsonPath)}>
              <Text style={styles.smallBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        )}

        {!!bvhPath && (
          <View style={styles.outRow}>
            <Text style={styles.path} numberOfLines={2}>BVH: {bvhPath}</Text>
            <TouchableOpacity style={styles.smallBtn} onPress={() => onShare(bvhPath)}>
              <Text style={styles.smallBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        )}

        {!jsonPath && !bvhPath && (
          <Text style={styles.muted}>Henüz export yapılmadı.</Text>
        )}
      </View>

      <Text style={styles.footer}>
        Not: Şimdilik take seçimi manuel. Bir sonraki adımda TakesListScreen’den seçip buraya route param ile taşıyacağız.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 28, fontWeight: "900" },
  sub: { opacity: 0.7, marginBottom: 6 },

  card: {
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },

  label: { fontWeight: "800", opacity: 0.85 },
  input: {
    backgroundColor: "white",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },

  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },

  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.12)",
  },
  pillActive: { backgroundColor: "#111" },
  pillText: { fontWeight: "800" },
  pillTextActive: { color: "white" },

  btn: {
    marginTop: 10,
    backgroundColor: "#111",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "white", fontWeight: "900" },

  outRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    justifyContent: "space-between",
  },

  path: { flex: 1, fontSize: 12, opacity: 0.85 },
  muted: { opacity: 0.65 },

  smallBtn: {
    backgroundColor: "#111",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  smallBtnText: { color: "white", fontWeight: "900", fontSize: 12 },

  footer: { opacity: 0.6, fontSize: 12, marginTop: 4 },
});
