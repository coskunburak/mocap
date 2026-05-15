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
    start: "#000000",
    end: "#050609",
    ribbonA: "rgba(255, 255, 255, 0.028)",
    ribbonB: "rgba(108, 242, 214, 0.045)",
    ribbonC: "rgba(255, 255, 255, 0.022)",
    line: "rgba(255, 255, 255, 0.055)",
    glow: "rgba(108, 242, 214, 0.05)",
  },
  accent: {
    start: "#000000",
    end: "#07090D",
    ribbonA: "rgba(108, 242, 214, 0.07)",
    ribbonB: "rgba(255, 255, 255, 0.035)",
    ribbonC: "rgba(123, 198, 255, 0.035)",
    line: "rgba(255, 255, 255, 0.06)",
    glow: "rgba(108, 242, 214, 0.06)",
  },
  danger: {
    start: "#030000",
    end: "#090407",
    ribbonA: "rgba(255, 115, 143, 0.08)",
    ribbonB: "rgba(255, 255, 255, 0.03)",
    ribbonC: "rgba(255, 115, 143, 0.035)",
    line: "rgba(255, 255, 255, 0.05)",
    glow: "rgba(255, 115, 143, 0.07)",
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.045)",
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
