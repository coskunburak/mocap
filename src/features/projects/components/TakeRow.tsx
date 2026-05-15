import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, type ButtonVariant } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { colors, radii, spacing, typography } from "../../../ui/theme";

export type TakeAction = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
};

type Props = {
  title: string;
  timestamp: string;
  subtitle: string;
  highlight?: string;
  badge?: string;
  tone?: "default" | "accent" | "muted" | "danger";
  onPress?: () => void;
  actions?: TakeAction[];
};

export function TakeRow({
  title,
  timestamp,
  subtitle,
  highlight,
  badge,
  tone = "default",
  onPress,
  actions,
}: Props) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <Card tone={tone} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.subtitle}>{subtitle}</Text>
        {highlight ? <Text style={styles.highlight}>{highlight}</Text> : null}

        {actions?.length ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                variant={action.variant ?? "secondary"}
                size="sm"
                disabled={action.disabled}
                loading={action.loading}
                onPress={action.onPress}
              />
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    transform: [{ scale: 0.992 }],
  },
  card: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.label.lg,
  },
  timestamp: {
    ...typography.body.sm,
  },
  subtitle: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
  highlight: {
    ...typography.label.sm,
    color: colors.info,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: "rgba(0, 0, 0, 0.52)",
  },
  badgeText: {
    ...typography.label.sm,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
