import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radii, spacing, typography } from "../../../ui/theme";

export function FPSBadge({ poseFps }: { poseFps: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.label}>Pose FPS</Text>
      <Text style={styles.text}>{Math.round(poseFps)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: spacing.sm,
    top: spacing.sm,
    minWidth: 84,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: "rgba(8, 16, 26, 0.54)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  label: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  text: {
    ...typography.title.card,
    fontSize: 18,
    lineHeight: 20,
  },
});
