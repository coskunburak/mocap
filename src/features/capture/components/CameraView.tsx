import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Linking, Platform } from "react-native";
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera";

type Props = {
  onLayoutSize?: (w: number, h: number) => void;
};

export function CameraView({ onLayoutSize }: Props) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const [layout, setLayout] = useState({ w: 0, h: 0 });

  useEffect(() => {
    // Quick sanity check for native module/component availability.
    // eslint-disable-next-line no-console
    console.log("[CameraView] Camera component:", Camera);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[CameraView] device:", device?.name ?? null, "hasPermission:", hasPermission);
  }, [device, hasPermission]);

  useEffect(() => {
    (async () => {
      if (!hasPermission) await requestPermission();
    })();
  }, [hasPermission, requestPermission]);

  const content = useMemo(() => {
    if (!device) return <Text style={{ padding: 12 }}>Camera device not found.</Text>;

    if (!hasPermission) {
      return (
        <View style={{ padding: 12 }}>
          <Text style={{ marginBottom: 8 }}>Camera permission required.</Text>
          <Text onPress={() => Linking.openSettings()} style={{ textDecorationLine: "underline" }}>
            Open Settings
          </Text>
        </View>
      );
    }

    return (
      <Camera
        style={{ flex: 1 }}
        device={device}
        isActive={true}
        photo={false}
        video={false}
        audio={false}
      />
    );
  }, [device, hasPermission]);

  return (
    <View
      style={{ flex: 1, borderRadius: 16, overflow: "hidden" }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setLayout({ w: width, h: height });
        onLayoutSize?.(width, height);
      }}
    >
      {content}
    </View>
  );
}
