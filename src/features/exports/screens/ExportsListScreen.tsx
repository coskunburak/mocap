import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function ExportsListScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Exports</Text>
      <Text style={styles.sub}>Sprint 5’te BVH çıktıları burada listelenecek.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  title: { fontSize: 24, fontWeight: "900" },
  sub: { opacity: 0.7 },
});
