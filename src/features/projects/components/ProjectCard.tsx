import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "../../../ui/components/Card";
import { colors, radii, spacing, typography } from "../../../ui/theme";

export type ProjectCardProps = {
  title: string;
  sessionCount: number;
  totalDuration: string;
  lastUpdated: string;
  averageFps: string;
  highlight: string;
  onPress?: () => void;
};

export function ProjectCard({
  title,
  sessionCount,
  totalDuration,
  lastUpdated,
  averageFps,
  highlight,
  onPress,
}: ProjectCardProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <Card tone="accent" style={styles.card}>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.highlight}>{highlight}</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{sessionCount} takes</Text>
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric label="Duration" value={totalDuration} />
          <Metric label="Avg FPS" value={averageFps} />
          <Metric label="Updated" value={lastUpdated} />
        </View>
      </Card>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    transform: [{ scale: 0.992 }],
  },
  card: {
    gap: spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.title.card,
  },
  highlight: {
    ...typography.body.md,
  },
  countBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: "rgba(108, 242, 214, 0.12)",
  },
  countText: {
    ...typography.label.sm,
    color: colors.textPrimary,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    minWidth: 96,
    flexGrow: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.xxs,
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    borderWidth: 1,
    borderColor: colors.line,
  },
  metricLabel: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  metricValue: {
    ...typography.label.md,
  },
});
