/**
 * MultiViewSetupScreen – Setup flow for dual-camera capture.
 *
 * Users choose Host/Guest role, connect to each other,
 * then proceed to calibration and capture.
 */

import React, { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { routes } from "../../../app/navigation/routes";
import { Button } from "../../../ui/components/Button";
import { Screen } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import { DEFAULT_PORT } from "../../../infra/networking/PeerProtocol";
import { useMultiViewCapture } from "../hooks/useMultiViewCapture";
import { useMultiViewStore } from "../state/multiViewStore";

type Nav = any;

// ─── Role selector ─────────────────────────────────────────────────

function RoleCard({
  role,
  selected,
  onPress,
}: {
  role: "host" | "guest";
  selected: boolean;
  onPress: () => void;
}) {
  const isHost = role === "host";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleCard,
        selected && styles.roleCardSelected,
        pressed && styles.roleCardPressed,
      ]}
    >
      <View style={styles.roleIconWrap}>
        <View style={isHost ? styles.hostGlyph : styles.guestGlyph}>
          <View style={styles.glyphDot} />
          <View style={[styles.glyphDot, styles.glyphDotMuted]} />
        </View>
      </View>
      <Text style={styles.roleTitle}>{isHost ? "Host" : "Guest"}</Text>
      <Text style={styles.roleDesc}>
        {isHost
          ? "Controls capture and matches local/remote frames"
          : "Streams landmark frames to the host timeline"}
      </Text>
      {selected && <View style={styles.roleCheckmark} />}
    </Pressable>
  );
}

// ─── Connection status indicator ───────────────────────────────────

function ConnectionBadge() {
  const { connectionState, connectionError, remoteDevice, timeSyncReady, syncRtt } =
    useMultiViewStore();

  const statusColor =
    connectionState === "ready" || connectionState === "capturing"
      ? colors.accent
      : connectionState === "error"
        ? colors.danger
        : connectionState === "listening" || connectionState === "connected" || connectionState === "syncing"
          ? colors.warning
          : colors.textMuted;

  const label =
    connectionState === "disconnected"
      ? "Waiting for connection..."
      : connectionState === "listening"
        ? "Host listening for Guest..."
      : connectionState === "connecting"
        ? "Connecting..."
        : connectionState === "connected"
          ? "Connected, syncing..."
          : connectionState === "syncing"
            ? "Time synchronization..."
            : connectionState === "calibrating"
              ? "Calibrating..."
              : connectionState === "ready"
                ? `Ready${remoteDevice ? ` · ${remoteDevice.name}` : ""}`
                : connectionState === "capturing"
                  ? "Capturing"
                  : connectionState === "error"
                    ? connectionError ?? "Connection error"
                    : connectionState;

  return (
    <View style={styles.statusCard}>
      <View style={styles.badgeRow}>
        <View style={[styles.badgeDot, { backgroundColor: statusColor }]} />
        <Text style={styles.badgeLabel}>{label}</Text>
      </View>
      {timeSyncReady && (
        <Text style={styles.badgeMeta}>
          Sync RTT: {syncRtt.toFixed(0)}ms · Clock aligned
        </Text>
      )}
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────

export default function MultiViewSetupScreen() {
  const navigation = useNavigation<Nav>();
  const [selectedRole, setSelectedRole] = useState<"host" | "guest">("host");
  const [hostIp, setHostIp] = useState("");
  const [hostPort, setHostPort] = useState(String(DEFAULT_PORT));
  const [connecting, setConnecting] = useState(false);

  const {
    state,
    startHost,
    stopHost,
    startGuest,
    stopGuest,
  } = useMultiViewCapture();

  const isSessionActive =
    state.connectionState !== "disconnected" && state.connectionState !== "error";
  const canProceed =
    state.connectionState === "ready" || state.connectionState === "capturing";

  const handleStart = useCallback(async () => {
    setConnecting(true);
    try {
      if (selectedRole === "host") {
        await startHost(parseInt(hostPort, 10) || DEFAULT_PORT);
      } else {
        if (!hostIp.trim()) {
          Alert.alert("IP Required", "Enter the Host phone's IP address.");
          return;
        }
        await startGuest(hostIp.trim(), parseInt(hostPort, 10) || DEFAULT_PORT);
      }
    } catch (err: any) {
      Alert.alert("Connection Error", err?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }, [selectedRole, hostIp, hostPort, startHost, startGuest]);

  const handleDisconnect = useCallback(async () => {
    const activeRole =
      state.peerRole === "host" || state.peerRole === "guest"
        ? state.peerRole
        : selectedRole;

    if (activeRole === "host") {
      await stopHost();
    } else {
      await stopGuest();
    }
  }, [selectedRole, state.peerRole, stopHost, stopGuest]);

  const handleProceed = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <Screen scroll background="default" contentContainerStyle={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>DUAL CAMERA</Text>
        <Text style={styles.heroTitle}>Set up capture</Text>
        <Text style={styles.heroCopy}>
          One Host controls recording while one Guest streams landmarks for frame matching and 3D solve.
        </Text>
        <View style={styles.flowRow}>
          <Text style={styles.flowChip}>connect</Text>
          <Text style={styles.flowChip}>sync</Text>
          <Text style={styles.flowChip}>calibrate</Text>
          <Text style={styles.flowChip}>capture</Text>
        </View>
      </View>

      {!isSessionActive ? (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Role</Text>
            <View style={styles.roleRow}>
              <RoleCard
                role="host"
                selected={selectedRole === "host"}
                onPress={() => setSelectedRole("host")}
              />
              <RoleCard
                role="guest"
                selected={selectedRole === "guest"}
                onPress={() => setSelectedRole("guest")}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {selectedRole === "host" ? "Host endpoint" : "Guest endpoint"}
            </Text>
            <View style={styles.setupCard}>
              {selectedRole === "guest" && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Host IP Address</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="192.168.1.xxx"
                    placeholderTextColor={colors.textMuted}
                    value={hostIp}
                    onChangeText={setHostIp}
                    keyboardType="numeric"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              )}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Port</Text>
                <TextInput
                  style={styles.input}
                  placeholder={String(DEFAULT_PORT)}
                  placeholderTextColor={colors.textMuted}
                  value={hostPort}
                  onChangeText={setHostPort}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {state.connectionState === "error" ? (
            <View style={styles.section}>
              <ConnectionBadge />
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live session</Text>
          <ConnectionBadge />

          {state.peerRole === "host" && state.hostIp ? (
            <View style={styles.hostAddressCard}>
              <Text style={styles.ipLabel}>Host address</Text>
              <Text style={styles.ipValue}>
                {state.hostIp}:{state.hostPort ?? DEFAULT_PORT}
              </Text>
              <Text style={styles.ipHint}>Use this address on the Guest phone.</Text>
            </View>
          ) : null}

          <View style={styles.metricsGrid}>
            <View style={styles.metricCell}>
              <Text style={styles.metricValue}>{state.remoteFrameCount}</Text>
              <Text style={styles.metricLabel}>remote frames</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricValue}>{state.matchedFrameCount}</Text>
              <Text style={styles.metricLabel}>matched pairs</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricValue}>{state.syncRtt.toFixed(0)}ms</Text>
              <Text style={styles.metricLabel}>sync rtt</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.actions}>
        {!isSessionActive ? (
          <Button
            label={selectedRole === "host" ? "Start Host" : "Connect Guest"}
            variant="primary"
            size="lg"
            fullWidth
            loading={connecting}
            onPress={handleStart}
          />
        ) : (
          <>
            <Button
              label={canProceed ? "Open Capture" : "Waiting for Sync"}
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canProceed}
              onPress={handleProceed}
            />
            <Button
              label="Disconnect"
              variant="ghost"
              size="md"
              fullWidth
              onPress={handleDisconnect}
            />
          </>
        )}

        <Button
          label="Solo Capture"
          variant="ghost"
          size="sm"
          onPress={() => navigation.navigate(routes.Capture as never)}
        />
      </View>
    </Screen>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    paddingBottom: 118,
    gap: spacing.lg,
    backgroundColor: colors.black,
  },
  hero: {
    minHeight: 204,
    justifyContent: "flex-end",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: "#05070b",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  eyebrow: {
    ...typography.eyebrow.sm,
    color: colors.accent,
  },
  heroTitle: {
    ...typography.title.hero,
    color: colors.white,
    letterSpacing: 0,
  },
  heroCopy: {
    ...typography.body.md,
    color: "rgba(255,255,255,0.68)",
    lineHeight: 22,
  },
  flowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  flowChip: {
    ...typography.label.sm,
    color: colors.white,
    letterSpacing: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radii.pill,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.eyebrow.sm,
    color: "rgba(255,255,255,0.54)",
  },
  roleRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  roleCard: {
    flex: 1,
    padding: spacing.md,
    minHeight: 172,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  roleCardSelected: {
    borderColor: colors.accent,
    backgroundColor: "rgba(108, 242, 214, 0.1)",
  },
  roleCardPressed: {
    transform: [{ scale: 0.97 }],
  },
  roleIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  hostGlyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  guestGlyph: {
    width: 18,
    height: 30,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  glyphDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  glyphDotMuted: {
    width: 4,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  roleTitle: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 24,
    lineHeight: 28,
  },
  roleDesc: {
    ...typography.body.sm,
    color: "rgba(255,255,255,0.62)",
    lineHeight: 19,
  },
  roleCheckmark: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 11,
    height: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  setupCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  inputGroup: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  inputLabel: {
    ...typography.label.sm,
    color: "rgba(255,255,255,0.6)",
  },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.54)",
    paddingHorizontal: spacing.md,
    color: colors.white,
    ...typography.body.md,
  },
  statusCard: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
  },
  badgeLabel: {
    ...typography.label.md,
    color: colors.white,
    flex: 1,
    letterSpacing: 0,
  },
  badgeMeta: {
    ...typography.body.sm,
    color: "rgba(255,255,255,0.62)",
    marginTop: spacing.xs,
  },
  hostAddressCard: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: "rgba(108,242,214,0.1)",
    borderWidth: 1,
    borderColor: "rgba(108,242,214,0.28)",
  },
  ipLabel: {
    ...typography.eyebrow.sm,
    color: "rgba(255,255,255,0.58)",
  },
  ipValue: {
    ...typography.title.hero,
    color: colors.accent,
    marginTop: spacing.xs,
    letterSpacing: 0,
    fontSize: 34,
    lineHeight: 39,
  },
  ipHint: {
    ...typography.body.sm,
    color: "rgba(255,255,255,0.62)",
    marginTop: spacing.xs,
  },
  metricsGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  metricCell: {
    flex: 1,
    minHeight: 82,
    justifyContent: "center",
    padding: spacing.sm,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  metricValue: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 21,
    lineHeight: 25,
  },
  metricLabel: {
    ...typography.label.sm,
    color: "rgba(255,255,255,0.52)",
    letterSpacing: 0,
    marginTop: 4,
  },
  actions: {
    gap: spacing.sm,
    alignItems: "center",
    marginTop: spacing.md,
  },
});
