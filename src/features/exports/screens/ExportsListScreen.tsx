import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { Take } from "../../../domain/mocap/models/Take";
import { env } from "../../../app/config/env";
import { routes } from "../../../app/navigation/routes";
import type {
  ExportFormat,
  ExportPresetId,
} from "../../../domain/mocap/pipeline/export/ExportPresets";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import { TakeRow } from "../../projects/components/TakeRow";
import {
  takeBadge,
  takeHighlight,
  takeTone,
} from "../../takes/lib/takeStatus";

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

type Nav = any;

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
  const navigation = useNavigation<Nav>();
  const { exporting, lastError, runExport } = useExportTake();

  const [takes, setTakes] = useState<Take[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await takeRepoFs.listTakes();
    setTakes(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          setLoading(true);
          const list = await takeRepoFs.listTakes();
          if (active) setTakes(list);
        } finally {
          if (active) setLoading(false);
        }
      })();

      return () => {
        active = false;
      };
    }, []),
  );

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
        { cancelable: true },
      );
    },
    [load],
  );

  const exportOne = useCallback(
    async (t: Take, format: ExportFormat, presetId?: ExportPresetId) => {
      await runExport(t.id, format, presetId);
    },
    [runExport],
  );

  const header = useMemo(() => {
    const totalFrames = takes.reduce((acc, take) => acc + take.frameCount, 0);
    const totalDuration = takes.reduce((acc, take) => acc + take.durationMs, 0);

    return (
      <View style={styles.header}>
        <ScreenHeader
          eyebrow="Export Queue"
          title="Backend-generated motion results."
          subtitle="Production captures are uploaded as original video and metadata, processed by backend workers, then returned here as downloadable result files."
        />
        <View style={styles.statsRow}>
          <StatCard label="Takes ready" value={String(takes.length)} />
          <StatCard label="Total frames" value={String(totalFrames)} />
          <StatCard
            label="Recorded time"
            value={formatDuration(totalDuration)}
          />
        </View>
        {lastError ? (
          <Card tone="danger" style={styles.errorCard}>
            <Text style={styles.errorTitle}>Last export error</Text>
            <Text style={styles.errorText}>{lastError}</Text>
          </Card>
        ) : null}
      </View>
    );
  }, [lastError, takes]);

  if (loading) {
    return (
      <Screen background="accent" contentContainerStyle={styles.loaderScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loaderText}>Loading export queue...</Text>
      </Screen>
    );
  }

  return (
    <Screen background="accent" contentContainerStyle={styles.container}>
      <FlatList
        ListHeaderComponent={header}
        data={takes}
        keyExtractor={(t) => t.id}
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TakeRow
            title={item.name}
            timestamp={fmtDate(item.createdAt)}
            subtitle={`${item.frameCount} frames • ${formatDuration(item.durationMs)} • ${fmtNum(item.avgFps)} fps`}
            highlight={takeHighlight(item)}
            badge={takeBadge(item)}
            tone={takeTone(item)}
            onPress={() =>
              navigation.navigate(routes.Review, { takeId: item.id })
            }
            actions={[
              {
                label: "Review",
                variant: "secondary",
                disabled: exporting,
                onPress: () =>
                  navigation.navigate(routes.Review, { takeId: item.id }),
              },
              item.remote?.status === "completed" && item.remote?.takeId
                ? {
                    label: "Result",
                    variant: "primary",
                    disabled: exporting,
                    onPress: () =>
                      navigation.navigate(routes.ExportResult, {
                        localTakeId: item.id,
                        remoteTakeId: item.remote?.takeId,
                        jobId: item.remote?.jobId,
                      }),
                  }
                : item.remote?.jobId
                  ? {
                      label: "Status",
                      variant: "primary",
                      disabled: exporting,
                      onPress: () =>
                        navigation.navigate(routes.ProcessingStatus, {
                          localTakeId: item.id,
                          remoteTakeId: item.remote?.takeId,
                          jobId: item.remote?.jobId,
                        }),
                    }
                  : {
                      label: "Upload",
                      variant: "primary",
                      disabled: exporting || !item.video || !item.captureMetadata,
                      onPress: () =>
                        navigation.navigate(routes.UploadProgress, {
                          takeId: item.id,
                        }),
                    },
              ...(env.enableLocalDebugExport
                ? [
                    {
                      label: "Debug Bundle",
                      variant: "ghost" as const,
                      disabled: exporting,
                      loading: exporting,
                      onPress: () => exportOne(item, "bundle", "dcc-archive"),
                    },
                  ]
                : []),
              {
                label: "Delete",
                variant: "danger",
                disabled: exporting,
                onPress: () => confirmDelete(item),
              },
            ]}
          />
        )}
        ListEmptyComponent={
          <Card tone="accent" style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No takes available.</Text>
            <Text style={styles.emptyText}>
              Record a take in the capture tab to populate the export queue and
              unlock file generation.
            </Text>
          </Card>
        }
      />
    </Screen>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function formatDuration(ms: number) {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const styles = StyleSheet.create({
  loaderScreen: {
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  loaderText: {
    ...typography.body.md,
  },
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
    marginHorizontal: -spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  header: {
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statCard: {
    minWidth: 140,
    flexGrow: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  statValue: {
    ...typography.title.card,
  },
  errorCard: {
    gap: spacing.xs,
  },
  errorTitle: {
    ...typography.label.md,
    color: colors.textPrimary,
  },
  errorText: {
    ...typography.body.md,
    color: colors.textPrimary,
  },
  emptyCard: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyTitle: {
    ...typography.title.card,
  },
  emptyText: {
    ...typography.body.md,
  },
});
