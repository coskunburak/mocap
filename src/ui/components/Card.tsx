import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, shadows, spacing } from "../theme";

type CardTone = "default" | "accent" | "muted" | "danger";
type CardPadding = "sm" | "md" | "lg";

const TONES: Record<CardTone, ViewStyle> = {
  default: {
    backgroundColor: "rgba(9, 10, 14, 0.86)",
    borderColor: colors.border,
  },
  accent: {
    backgroundColor: "rgba(7, 9, 12, 0.9)",
    borderColor: colors.borderAccent,
  },
  muted: {
    backgroundColor: "rgba(5, 6, 9, 0.84)",
    borderColor: colors.line,
  },
  danger: {
    backgroundColor: "rgba(25, 6, 12, 0.86)",
    borderColor: "rgba(255, 115, 143, 0.24)",
  },
};

const PADDING: Record<CardPadding, number> = {
  sm: spacing.md,
  md: spacing.lg,
  lg: spacing.xl,
};

type Props = {
  children: React.ReactNode;
  tone?: CardTone;
  padding?: CardPadding;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  children,
  tone = "default",
  padding = "md",
  style,
}: Props) {
  return (
    <View
      style={[styles.base, TONES[tone], { padding: PADDING[padding] }, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    ...shadows.panel,
  },
});
