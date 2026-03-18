import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, radii, shadows, spacing, typography } from "../theme";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success";
export type ButtonSize = "sm" | "md" | "lg";

type Props = Omit<PressableProps, "style"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftAccessory?: React.ReactNode;
  rightAccessory?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const HEIGHTS: Record<ButtonSize, number> = {
  sm: 40,
  md: 50,
  lg: 58,
};

const PADDINGS: Record<ButtonSize, number> = {
  sm: spacing.md,
  md: spacing.lg,
  lg: spacing.xl,
};

const VARIANTS: Record<ButtonVariant, ViewStyle> = {
  primary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: colors.transparent,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  success: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
};

const TEXT_VARIANTS: Record<ButtonVariant, TextStyle> = {
  primary: { color: colors.background },
  secondary: { color: colors.textPrimary },
  ghost: { color: colors.textPrimary },
  danger: { color: colors.white },
  success: { color: colors.background },
};

export function Button({
  label,
  variant = "primary",
  size = "md",
  fullWidth,
  disabled,
  loading,
  leftAccessory,
  rightAccessory,
  style,
  textStyle,
  ...props
}: Props) {
  const textColor = TEXT_VARIANTS[variant].color ?? colors.textPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        VARIANTS[variant],
        variant === "primary" || variant === "danger" || variant === "success"
          ? shadows.glow
          : null,
        fullWidth ? styles.fullWidth : null,
        pressed && !disabled && !loading ? styles.pressed : null,
        disabled || loading ? styles.disabled : null,
        style,
      ]}
      {...props}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          leftAccessory
        )}
        <Text style={[styles.label, TEXT_VARIANTS[variant], textStyle]}>
          {label}
        </Text>
        {rightAccessory}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 96,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sm: {
    minHeight: HEIGHTS.sm,
    paddingHorizontal: PADDINGS.sm,
  },
  md: {
    minHeight: HEIGHTS.md,
    paddingHorizontal: PADDINGS.md,
  },
  lg: {
    minHeight: HEIGHTS.lg,
    paddingHorizontal: PADDINGS.lg,
  },
  fullWidth: {
    width: "100%",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  label: {
    ...typography.label.md,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
