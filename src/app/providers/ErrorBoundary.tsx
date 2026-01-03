
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("UI Crash", { error, info });
  }

  reset = () => this.setState({ hasError: false, message: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Bir şeyler ters gitti.</Text>
        <Text style={styles.msg}>{this.state.message ?? "Bilinmeyen hata"}</Text>
        <Pressable style={styles.btn} onPress={this.reset}>
          <Text style={styles.btnText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "800" },
  msg: { fontSize: 14, opacity: 0.8, textAlign: "center" },
  btn: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  btnText: { fontSize: 16, fontWeight: "700" },
});
