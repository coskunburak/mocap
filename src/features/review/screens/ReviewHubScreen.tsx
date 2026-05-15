import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { Take } from "../../../domain/mocap/models/Take";
import { routes } from "../../../app/navigation/routes";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import { TakeRow } from "../../projects/components/TakeRow";
import {
  takeBadge,
  takeHighlight,
  takeTone,
} from "../../takes/lib/takeStatus";

type Nav = any;

function formatDuration(ms: number) {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleString();
}

function reviewRank(take: Take) {
  if (take.review?.status === "needs-work") return 0;
  if (take.review?.status === "approved") return 2;
  return 1;
}

function reviewSummary(take: Take) {
  const parts = [
    `${take.frameCount} frames`,
    formatDuration(take.durationMs),
    take.review
      ? `${take.review.qualityScore}% review`
      : take.qualityScore != null
        ? `${take.qualityScore}% quality`
        : undefined,
  ].filter(Boolean);

  return parts.join(" • ");
}

export default function ReviewHubScreen() {
  const navigation = useNavigation<Nav>();
  const [takes, setTakes] = useState<Take[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await takeRepoFs.listTakes();
    list.sort((a, b) => {
      const byRank = reviewRank(a) - reviewRank(b);
      if (byRank !== 0) return byRank;
      return b.updatedAt - a.updatedAt;
    });
    setTakes(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        try {
          setLoading(true);
          const list = await takeRepoFs.listTakes();
          list.sort((a, b) => {
            const byRank = reviewRank(a) - reviewRank(b);
            if (byRank !== 0) return byRank;
            return b.updatedAt - a.updatedAt;
          });
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

  const reviewStats = useMemo(() => {
    let pending = 0;
    let needsWork = 0;
    let approved = 0;

    for (const take of takes) {
      if (take.review?.status === "approved") {
        approved += 1;
      } else if (take.review?.status === "needs-work") {
        needsWork += 1;
      } else {
        pending += 1;
      }
    }

    return { pending, needsWork, approved };
  }, [takes]);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <ScreenHeader
          eyebrow="Review Lab"
          title="Inspect every take before export."
          subtitle="Open playback, scrub the motion, trim the usable range, and approve only the takes that are clean enough for handoff."
          right={
            <Button
              label="Capture"
              variant="secondary"
              size="sm"
              onPress={() => navigation.navigate(routes.Capture)}
            />
          }
        />

        <View style={styles.statsRow}>
          <StatCard label="Pending" value={String(reviewStats.pending)} />
          <StatCard label="Needs work" value={String(reviewStats.needsWork)} />
          <StatCard label="Approved" value={String(reviewStats.approved)} />
        </View>
      </View>
    ),
    [navigation, reviewStats.approved, reviewStats.needsWork, reviewStats.pending],
  );

  if (loading) {
    return (
      <Screen background="accent" contentContainerStyle={styles.loaderScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loaderText}>Loading review queue...</Text>
      </Screen>
    );
  }

  return (
    <Screen background="accent" contentContainerStyle={styles.container}>
      <FlatList
        data={takes}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <TakeRow
            title={item.name}
            timestamp={formatDate(item.createdAt)}
            subtitle={reviewSummary(item)}
            highlight={takeHighlight(item)}
            badge={takeBadge(item)}
            tone={takeTone(item)}
            onPress={() => navigation.navigate(routes.MotionPreview, { takeId: item.id })}
            actions={[
              {
                label: "Preview",
                variant: "primary",
                onPress: () => navigation.navigate(routes.MotionPreview, { takeId: item.id }),
              },
              {
                label: "Review",
                variant: "secondary",
                onPress: () => navigation.navigate(routes.Review, { takeId: item.id }),
              },
              {
                label: "Export",
                variant: "secondary",
                onPress: () => navigation.navigate(routes.Export, { takeId: item.id }),
              },
            ]}
          />
        )}
        ListEmptyComponent={
          <Card tone="accent" style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No takes to review yet.</Text>
            <Text style={styles.emptyText}>
              Start a capture session, record a take, and it will appear here for
              playback, trim, approval, and export.
            </Text>
            <Button
              label="Open capture"
              onPress={() => navigation.navigate(routes.Capture)}
            />
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
    paddingBottom: 118,
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
    minWidth: 120,
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
  emptyCard: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyTitle: {
    ...typography.title.card,
  },
  emptyText: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
});
