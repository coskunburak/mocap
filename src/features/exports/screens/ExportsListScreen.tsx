import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from "react-native";
import type { Take } from "../../../domain/mocap/models/Take";

let takeRepoFs: typeof import("../../../infra/persistence/TakeRepo.fs").takeRepoFs;
try {
  takeRepoFs = require("../../../infra/persistence/TakeRepo.fs").takeRepoFs;
} catch (e) {
  console.error("[ExportsList] takeRepoFs load failed", e);
  throw e;
}

let useExportTake: typeof import("../../takes/export/useExportTake").useExportTake;
try {
  useExportTake = require("../../takes/export/useExportTake").useExportTake;
} catch (e) {
  console.error("[ExportsList] useExportTake load failed", e);
  throw e;
}

type Format = "bvh" | "json" | "both";

function fmtDate(ms: number) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function fmtNum(n: number) {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(1);
}

export default function ExportsListScreen() {
  const { exporting, lastError, runExport } = useExportTake();

  const [takes, setTakes] = useState<Take[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await takeRepoFs.listTakes();
    setTakes(list);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const confirmDelete = useCallback(
    (t: Take) => {
      Alert.alert(
        "Delete take?",
        `"${t.name}" will be deleted permanently.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await takeRepoFs.deleteTake(t.id);
              await load();
            },
          },
        ],
        { cancelable: true }
      );
    },
    [load]
  );

  const exportOne = useCallback(
    async (t: Take, format: Format) => {
      await runExport(t.id, format);
    },
    [runExport]
  );

  const header = useMemo(() => {
    return (
      <View style={styles.header}>
        <Text style={styles.title}>Exports</Text>
        <Text style={styles.sub}>
          Recorded takes are listed here. Export will generate BVH/JSON and open share sheet.
        </Text>
        {lastError ? <Text style={styles.err}>Error: {lastError}</Text> : null}
      </View>
    );
  }, [lastError]);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, opacity: 0.7 }}>Loading takes…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ListHeaderComponent={header}
        data={takes}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ gap: 4 }}>
              <Text style={styles.takeTitle}>{item.name}</Text>
              <Text style={styles.meta}>
                {fmtDate(item.createdAt)} • frames={item.frameCount} • dur={Math.round(item.durationMs)}ms • avgFps={fmtNum(item.avgFps)}
              </Text>
              {item.projectId ? <Text style={styles.meta}>projectId={item.projectId}</Text> : null}
            </View>

            <View style={styles.actionsRow}>
              <ActionButton
                label="BVH"
                disabled={exporting}
                onPress={() => exportOne(item, "bvh")}
              />
              <ActionButton
                label="JSON"
                disabled={exporting}
                onPress={() => exportOne(item, "json")}
              />
              <ActionButton
                label="Both"
                disabled={exporting}
                onPress={() => exportOne(item, "both")}
              />
              <ActionButton
                label="Delete"
                danger
                disabled={exporting}
                onPress={() => confirmDelete(item)}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={{ padding: 16 }}>
            <Text style={{ opacity: 0.7 }}>
              No takes yet. Go to Capture tab and record a take.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        danger ? styles.btnDanger : styles.btnPrimary,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, gap: 6 },
  title: { fontSize: 26, fontWeight: "900" },
  sub: { opacity: 0.7, lineHeight: 18 },
  err: { marginTop: 6, color: "crimson" },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.04)",
    gap: 10,
  },
  takeTitle: { fontSize: 16, fontWeight: "800" },
  meta: { opacity: 0.7 },

  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  btn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  btnPrimary: { backgroundColor: "rgba(0,0,0,0.85)" },
  btnDanger: { backgroundColor: "rgba(220,0,0,0.85)" },
  btnText: { color: "white", fontWeight: "800" },
});
