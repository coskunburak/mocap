import React from "react";
import { View, Text, StyleSheet } from "react-native";

export function FPSBadge({ poseFps }: { poseFps: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{Math.round(poseFps)} fps</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: 12,
    top: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  text: { color: "white", fontWeight: "600" },
});
