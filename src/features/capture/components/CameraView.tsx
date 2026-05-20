import React, { useEffect, useMemo } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  requireNativeComponent,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useCameraPermission } from "react-native-vision-camera";
import { NativeCameraEngine } from "../data/NativeCameraEngine";
import { colors, radii, spacing, typography } from "../../../ui/theme";

type Props = {
  onLayoutSize?: (w: number, h: number) => void;
  isActive?: boolean;
  rounded?: boolean;
};

const NativePosePreviewView =
  Platform.OS === "android" || Platform.OS === "ios"
    ? requireNativeComponent<{ style?: object }>("PosePreviewView")
    : (props: any) => <View {...props} />;

export function CameraView({ onLayoutSize, isActive = true, rounded = true }: Props) {
  const isFocused = useIsFocused();
  const { hasPermission, requestPermission } = useCameraPermission();
  const previewEnabled = hasPermission && isFocused && isActive;

  useEffect(() => {
    (async () => {
      if (!hasPermission) await requestPermission();
    })();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    const task = previewEnabled
      ? NativeCameraEngine.startPreview()
      : NativeCameraEngine.stopPreview();
    void task.catch((error) => {
      console.warn("[CameraView] setPreviewActive failed", error);
    });

    return () => {
      void NativeCameraEngine.stopPreview().catch((error) => {
        console.warn("[CameraView] preview cleanup failed", error);
      });
    };
  }, [previewEnabled]);

  const content = useMemo(() => {
    if (!hasPermission) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallbackEyebrow}>Permission</Text>
          <Text style={styles.fallbackTitle}>Camera permission required.</Text>
          <Text style={styles.fallbackText}>
            Markerless capture preview ve WHAM upload akisi icin kamera erisimi
            gerekli.
          </Text>
          <Text onPress={() => Linking.openSettings()} style={styles.link}>
            Open Settings
          </Text>
        </View>
      );
    }

    return <NativePosePreviewView style={StyleSheet.absoluteFill} />;
  }, [hasPermission]);

  return (
    <View
      style={[styles.container, !rounded && styles.containerSquare]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        onLayoutSize?.(width, height);
      }}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.backgroundDeep,
  },
  containerSquare: {
    borderRadius: 0,
  },
  fallback: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.xs,
    backgroundColor: "rgba(6, 16, 26, 0.88)",
  },
  fallbackEyebrow: {
    ...typography.eyebrow.sm,
  },
  fallbackTitle: {
    ...typography.title.card,
  },
  fallbackText: {
    ...typography.body.md,
    maxWidth: 260,
  },
  link: {
    ...typography.label.md,
    color: colors.accent,
    marginTop: spacing.sm,
  },
});
