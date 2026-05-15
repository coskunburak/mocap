import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, radii, spacing, typography } from "../../ui/theme";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown) {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
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
        <View style={styles.panel}>
          <Text style={styles.eyebrow}>System fault</Text>
          <Text style={styles.title}>Bir şeyler ters gitti.</Text>
          <Text style={styles.msg}>
            {this.state.message ?? "Bilinmeyen hata"}
          </Text>
          <Pressable style={styles.btn} onPress={this.reset}>
            <Text style={styles.btnText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  panel: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 8,
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  eyebrow: {
    ...typography.eyebrow.sm,
  },
  title: {
    ...typography.title.card,
  },
  msg: {
    ...typography.body.md,
  },
  btn: {
    marginTop: spacing.xs,
    minHeight: 50,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  btnText: {
    ...typography.label.md,
    color: colors.background,
  },
});
