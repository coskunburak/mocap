import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import Svg, {
  Defs,
  LinearGradient,
  Line,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { colors, layout, radii, spacing, typography } from "../theme";

type BackgroundVariant = "default" | "accent" | "danger";

type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  background?: BackgroundVariant;
  scrollProps?: Omit<ScrollViewProps, "contentContainerStyle" | "children">;
};

const BACKGROUNDS: Record<
  BackgroundVariant,
  {
    start: string;
    end: string;
    ribbonA: string;
    ribbonB: string;
    ribbonC: string;
    line: string;
    glow: string;
  }
> = {
  default: {
    start: "#070A0F",
    end: "#111923",
    ribbonA: "rgba(255, 115, 88, 0.14)",
    ribbonB: "rgba(88, 185, 255, 0.12)",
    ribbonC: "rgba(255, 201, 120, 0.08)",
    line: "rgba(255, 255, 255, 0.06)",
    glow: "rgba(255, 138, 107, 0.08)",
  },
  accent: {
    start: "#080C12",
    end: "#131C27",
    ribbonA: "rgba(79, 214, 184, 0.12)",
    ribbonB: "rgba(113, 145, 255, 0.12)",
    ribbonC: "rgba(255, 176, 93, 0.10)",
    line: "rgba(255, 255, 255, 0.06)",
    glow: "rgba(79, 214, 184, 0.08)",
  },
  danger: {
    start: "#10090C",
    end: "#1A1115",
    ribbonA: "rgba(255, 114, 114, 0.16)",
    ribbonB: "rgba(255, 175, 111, 0.10)",
    ribbonC: "rgba(255, 255, 255, 0.05)",
    line: "rgba(255, 255, 255, 0.05)",
    glow: "rgba(255, 114, 114, 0.10)",
  },
};

export function Screen({
  children,
  scroll,
  style,
  contentContainerStyle,
  edges = ["top", "left", "right"],
  background = "default",
  scrollProps,
}: ScreenProps) {
  const content = scroll ? (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      {...scrollProps}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      <View style={styles.root}>
        <ScreenBackground variant={background} />
        {content}
      </View>
    </SafeAreaView>
  );
}

function ScreenBackground({ variant }: { variant: BackgroundVariant }) {
  const palette = BACKGROUNDS[variant];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 430 932"
        preserveAspectRatio="xMidYMid slice"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient
            id="screenGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <Stop offset="0%" stopColor={palette.start} />
            <Stop offset="100%" stopColor={palette.end} />
          </LinearGradient>
          <LinearGradient id="glowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={palette.glow} />
            <Stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </LinearGradient>
        </Defs>
        <Rect width="430" height="932" fill="url(#screenGradient)" />

        <Path
          d="M-28 124C58 60 170 36 302 66C354 78 394 76 458 42V286C370 306 286 292 204 248C124 204 50 204 -28 246Z"
          fill={palette.ribbonA}
        />
        <Path
          d="M252 -8C332 20 388 74 444 150V468C388 420 336 362 282 324C224 282 156 266 76 286V168C152 158 214 110 252 -8Z"
          fill={palette.ribbonB}
        />
        <Path
          d="M-36 620C72 552 176 530 286 548C354 560 414 596 462 652V954H-36Z"
          fill={palette.ribbonC}
        />

        <Rect width="430" height="932" fill="url(#glowGradient)" />

        <Line
          x1="0"
          y1="96"
          x2="430"
          y2="96"
          stroke={palette.line}
          strokeWidth="1"
        />
        <Line
          x1="0"
          y1="286"
          x2="430"
          y2="286"
          stroke={palette.line}
          strokeWidth="1"
        />
        <Line
          x1="0"
          y1="534"
          x2="430"
          y2="534"
          stroke={palette.line}
          strokeWidth="1"
        />
        <Line
          x1="0"
          y1="780"
          x2="430"
          y2="780"
          stroke={palette.line}
          strokeWidth="1"
        />
        <Line
          x1="28"
          y1="0"
          x2="28"
          y2="932"
          stroke={palette.line}
          strokeWidth="1"
        />
        <Line
          x1="402"
          y1="0"
          x2="402"
          y2="932"
          stroke={palette.line}
          strokeWidth="1"
        />
      </Svg>
      <View style={styles.frame} />
    </View>
  );
}

type ScreenHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
};

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xl,
    gap: layout.sectionGap,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing["3xl"],
    gap: layout.sectionGap,
  },
  frame: {
    position: "absolute",
    top: 18,
    right: 18,
    bottom: 18,
    left: 18,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.03)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  eyebrow: {
    ...typography.eyebrow.sm,
  },
  title: {
    ...typography.title.hero,
  },
  subtitle: {
    ...typography.body.lg,
    maxWidth: 620,
  },
});
