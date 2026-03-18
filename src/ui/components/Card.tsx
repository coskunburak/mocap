import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii, shadows, spacing } from "../theme";

type CardTone = "default" | "accent" | "muted" | "danger";
type CardPadding = "sm" | "md" | "lg";

const TONES: Record<CardTone, ViewStyle> = {
  default: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
  },
  accent: {
    backgroundColor: "rgba(16, 31, 46, 0.86)",
    borderColor: colors.borderAccent,
  },
  muted: {
    backgroundColor: "rgba(10, 21, 34, 0.84)",
    borderColor: colors.line,
  },
  danger: {
    backgroundColor: "rgba(43, 16, 25, 0.84)",
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
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: "hidden",
    ...shadows.panel,
  },
});
