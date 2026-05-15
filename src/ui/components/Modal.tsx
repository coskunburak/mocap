import React from "react";
import {
  Modal as RNModal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "./Button";
import { Card } from "./Card";
import { colors, radii, spacing, typography } from "../theme";

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function Modal({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: Props) {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Card tone="accent" padding="lg" style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? (
                <Text style={styles.subtitle}>{subtitle}</Text>
              ) : null}
            </View>
            <Button label="Close" variant="ghost" size="sm" onPress={onClose} />
          </View>
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Card>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    padding: spacing.xl,
    justifyContent: "center",
  },
  sheet: {
    borderRadius: 8,
    gap: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.title.card,
  },
  subtitle: {
    ...typography.body.md,
  },
  body: {
    gap: spacing.md,
  },
  footer: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
