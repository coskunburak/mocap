import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function ProjectsListScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Projects</Text>
      <Text style={styles.sub}>Sprint 3’te Take kayıtları buraya gelecek.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  title: { fontSize: 24, fontWeight: "900" },
  sub: { opacity: 0.7 },
});
