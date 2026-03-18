import { Platform, type TextStyle } from "react-native";
import { colors } from "./colors";

const families = {
  display: Platform.select({
    ios: "Avenir Next Condensed",
    android: "sans-serif-condensed",
    default: "System",
  }),
  body: Platform.select({
    ios: "Avenir Next",
    android: "sans-serif-medium",
    default: "System",
  }),
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }),
} as const;

type TypeScale = Record<string, TextStyle>;

export const typography: {
  families: typeof families;
  eyebrow: TypeScale;
  title: TypeScale;
  body: TypeScale;
  label: TypeScale;
  mono: TypeScale;
} = {
  families,
  eyebrow: {
    sm: {
      fontFamily: families.body,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 1.5,
      fontWeight: "700",
      color: colors.accent,
      textTransform: "uppercase",
    },
  },
  title: {
    hero: {
      fontFamily: families.display,
      fontSize: 40,
      lineHeight: 42,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    screen: {
      fontFamily: families.display,
      fontSize: 30,
      lineHeight: 32,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    card: {
      fontFamily: families.display,
      fontSize: 22,
      lineHeight: 24,
      fontWeight: "700",
      color: colors.textPrimary,
    },
  },
  body: {
    lg: {
      fontFamily: families.body,
      fontSize: 17,
      lineHeight: 24,
      color: colors.textSecondary,
      fontWeight: "500",
    },
    md: {
      fontFamily: families.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      fontWeight: "500",
    },
    sm: {
      fontFamily: families.body,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textMuted,
      fontWeight: "500",
    },
  },
  label: {
    lg: {
      fontFamily: families.body,
      fontSize: 16,
      lineHeight: 18,
      color: colors.textPrimary,
      fontWeight: "700",
    },
    md: {
      fontFamily: families.body,
      fontSize: 14,
      lineHeight: 16,
      color: colors.textPrimary,
      fontWeight: "700",
    },
    sm: {
      fontFamily: families.body,
      fontSize: 12,
      lineHeight: 14,
      color: colors.textSecondary,
      fontWeight: "700",
    },
  },
  mono: {
    sm: {
      fontFamily: families.mono,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textMuted,
      fontWeight: "500",
    },
  },
};
