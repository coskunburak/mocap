import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { Take } from "../../../domain/mocap/models/Take";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import { routes } from "../../../app/navigation/routes";
import { TakeRow } from "../components/TakeRow";
import {
  takeBadge,
  takeHighlight,
  takeTone,
} from "../../takes/lib/takeStatus";

type Nav = any;
type RouteParams = {
  projectId?: string;
  title?: string;
};

export default function ProjectDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params = route.params as RouteParams | undefined;
  const [takes, setTakes] = useState<Take[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const projectId = params?.projectId;
  const title =
    params?.title ??
    (projectId ? humanizeProjectId(projectId) : "Unassigned Sessions");

  const load = useCallback(async () => {
    const list = await takeRepoFs.listTakes();
    const filtered = list.filter((take) =>
      projectId ? take.projectId === projectId : !take.projectId,
    );
    setTakes(filtered);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          setLoading(true);
          const list = await takeRepoFs.listTakes();
          const filtered = list.filter((take) =>
            projectId ? take.projectId === projectId : !take.projectId,
          );
          if (active) setTakes(filtered);
        } finally {
          if (active) setLoading(false);
        }
      })();
      
      return () => {
        active = false;
      };
    }, [projectId]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const totalDuration = useMemo(
    () => takes.reduce((acc, take) => acc + take.durationMs, 0),
    [takes],
  );
  const averageFps = useMemo(() => {
    const fpsValues = takes
      .filter((take) => take.avgFps > 0)
      .map((take) => take.avgFps);
    if (fpsValues.length === 0) return 0;
    return fpsValues.reduce((acc, value) => acc + value, 0) / fpsValues.length;
  }, [takes]);

  if (loading) {
    return (
      <Screen background="accent" contentContainerStyle={styles.loaderScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loaderText}>Loading project sessions...</Text>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      background="accent"
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        ),
      }}
      contentContainerStyle={styles.content}
    >
      <ScreenHeader
        eyebrow="Project Detail"
        title={title}
        subtitle="Review every take in the group, validate frame quality, and jump straight into export when the session is approved."
        right={
          <Button
            label="Back"
            variant="ghost"
            size="sm"
            onPress={() => navigation.goBack()}
          />
        }
      />

      <View style={styles.metrics}>
        <MetricCard label="Takes" value={String(takes.length)} />
        <MetricCard label="Duration" value={formatDuration(totalDuration)} />
        <MetricCard label="Avg FPS" value={formatFps(averageFps)} />
      </View>

      {takes.length === 0 ? (
        <Card tone="muted" style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No takes in this project.</Text>
          <Text style={styles.emptyText}>
            Record a new session or assign captures into this project group to
            continue the workflow.
          </Text>
          <Button
            label="Open capture"
            onPress={() => navigation.navigate(routes.Capture)}
          />
        </Card>
      ) : (
        <View style={styles.list}>
          {takes.map((take) => (
            <TakeRow
              key={take.id}
              title={take.name}
              timestamp={formatFullDate(take.createdAt)}
              subtitle={`${take.frameCount} frames • ${formatDuration(take.durationMs)} • ${formatFps(take.avgFps)}`}
              highlight={takeHighlight(take)}
              badge={takeBadge(take)}
              tone={takeTone(take)}
              onPress={() =>
                navigation.navigate(routes.MotionPreview, {
                  takeId: take.id,
                })
              }
              actions={[
                {
                  label: "Preview",
                  variant: "primary",
                  onPress: () =>
                    navigation.navigate(routes.MotionPreview, {
                      takeId: take.id,
                    }),
                },
                {
                  label: "Review",
                  variant: "secondary",
                  onPress: () =>
                    navigation.navigate(routes.Review, {
                      takeId: take.id,
                    }),
                },
                {
                  label: "Export",
                  variant: "secondary",
                  onPress: () =>
                    navigation.navigate(routes.Export, {
                      takeId: take.id,
                    }),
                },
              ]}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function humanizeProjectId(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function formatFps(value: number) {
  return value > 0 ? `${value.toFixed(1)} fps` : "No fps data";
}

function formatFullDate(ms: number) {
  return new Date(ms).toLocaleString();
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
  content: {
    paddingBottom: 48,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    minWidth: 140,
    flexGrow: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  metricValue: {
    ...typography.title.card,
  },
  list: {
    gap: spacing.sm,
  },
  emptyCard: {
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.title.card,
  },
  emptyText: {
    ...typography.body.md,
  },
});
