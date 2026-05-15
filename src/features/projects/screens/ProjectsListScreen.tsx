import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { Take } from "../../../domain/mocap/models/Take";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { Card } from "../../../ui/components/Card";
import { Button } from "../../../ui/components/Button";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import { routes } from "../../../app/navigation/routes";
import { ProjectCard } from "../components/ProjectCard";
import { TakeRow } from "../components/TakeRow";
import {
  takeBadge,
  takeHighlight,
  takeTone,
} from "../../takes/lib/takeStatus";

type Nav = any;

type ProjectSummary = {
  id: string;
  title: string;
  takes: Take[];
  totalDurationMs: number;
  averageFps: number;
  updatedAt: number;
  highlight: string;
};

export default function ProjectsListScreen() {
  const navigation = useNavigation<Nav>();
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

  const projectSummaries = useMemo<ProjectSummary[]>(() => {
    const grouped = new Map<string, Take[]>();

    for (const take of takes) {
      const key = take.projectId?.trim() || "unassigned";
      const current = grouped.get(key) ?? [];
      current.push(take);
      grouped.set(key, current);
    }

    return Array.from(grouped.entries())
      .map(([id, list]) => {
        const totalDurationMs = list.reduce(
          (acc, item) => acc + item.durationMs,
          0,
        );
        const fpsValues = list
          .filter((item) => item.avgFps > 0)
          .map((item) => item.avgFps);
        const averageFps =
          fpsValues.length > 0
            ? fpsValues.reduce((acc, value) => acc + value, 0) /
              fpsValues.length
            : 0;
        const updatedAt = Math.max(...list.map((item) => item.updatedAt));
        const title = humanizeProjectId(id);
        return {
          id,
          title,
          takes: list,
          totalDurationMs,
          averageFps,
          updatedAt,
          highlight:
            id === "unassigned"
              ? "Sessions not yet attached to a dedicated production project."
              : "Grouped takes ready for review, cleanup, and export handoff.",
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [takes]);

  const totalDuration = useMemo(
    () => takes.reduce((acc, take) => acc + take.durationMs, 0),
    [takes],
  );
  const recentTakes = useMemo(() => takes.slice(0, 4), [takes]);

  if (loading) {
    return (
      <Screen background="accent" contentContainerStyle={styles.loaderScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loaderText}>Projects workspace is loading...</Text>
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
        eyebrow="Project Studio"
        title="Organize capture sessions into polished deliverables."
        subtitle="Track session health, cluster takes by project, and move the best recordings straight into export."
        right={
          <Button
            label="Open capture"
            variant="secondary"
            size="sm"
            onPress={() => navigation.navigate(routes.Capture)}
          />
        }
      />

      <View style={styles.overviewRow}>
        <OverviewStat label="Total takes" value={String(takes.length)} />
        <OverviewStat
          label="Project groups"
          value={String(projectSummaries.length)}
        />
        <OverviewStat
          label="Recorded time"
          value={formatDuration(totalDuration)}
        />
      </View>

      {takes.length === 0 ? (
        <Card tone="accent" style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No sessions yet.</Text>
          <Text style={styles.emptyText}>
            Start a capture pass to populate the workspace with takes,
            analytics, and export-ready assets.
          </Text>
          <Button
            label="Go to capture"
            variant="primary"
            onPress={() => navigation.navigate(routes.Capture)}
          />
        </Card>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>Projects</Text>
            <Text style={styles.sectionTitle}>Grouped sessions</Text>
          </View>

          <View style={styles.cards}>
            {projectSummaries.map((project) => (
              <ProjectCard
                key={project.id}
                title={project.title}
                sessionCount={project.takes.length}
                totalDuration={formatDuration(project.totalDurationMs)}
                lastUpdated={formatShortDate(project.updatedAt)}
                averageFps={formatFps(project.averageFps)}
                highlight={project.highlight}
                onPress={() =>
                  navigation.navigate(routes.ProjectDetail, {
                    projectId:
                      project.id === "unassigned" ? undefined : project.id,
                    title: project.title,
                  })
                }
              />
            ))}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>Recent takes</Text>
            <Text style={styles.sectionTitle}>Latest recorded sessions</Text>
          </View>

          <View style={styles.cards}>
            {recentTakes.map((take) => (
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
        </>
      )}
    </Screen>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function humanizeProjectId(value: string) {
  if (value === "unassigned") return "Unassigned Sessions";
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

function formatShortDate(ms: number) {
  return new Date(ms).toLocaleDateString();
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
    paddingBottom: 120,
  },
  overviewRow: {
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
  sectionHeader: {
    gap: spacing.xxs,
    marginTop: spacing.sm,
  },
  sectionEyebrow: {
    ...typography.eyebrow.sm,
  },
  sectionTitle: {
    ...typography.title.screen,
    fontSize: 24,
    lineHeight: 26,
  },
  cards: {
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
