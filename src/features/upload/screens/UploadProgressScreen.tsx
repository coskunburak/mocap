import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { container } from "../../../app/di/container";
import { routes } from "../../../app/navigation/routes";
import type { Take } from "../../../domain/mocap/models/Take";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import type { UploadProgressSnapshot } from "../domain/UploadManager";

type RouteParams = {
  takeId?: string;
};

type Nav = any;

const initialProgress: UploadProgressSnapshot = {
  stage: "idle",
  progress: 0,
  attempt: 1,
  message: "Waiting",
};

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function progressWidth(value: number): DimensionValue {
  return formatPercent(value) as DimensionValue;
}

function stageTitle(stage: UploadProgressSnapshot["stage"]) {
  switch (stage) {
    case "preparing":
      return "Prepare";
    case "uploading_metadata":
      return "Metadata";
    case "uploading_video":
      return "Video";
    case "completing":
      return "Verify";
    case "starting_processing":
      return "Process";
    case "completed":
      return "Queued";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "idle":
    default:
      return "Ready";
  }
}

export default function UploadProgressScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params = route?.params as RouteParams | undefined;
  const localTakeId = params?.takeId;

  const [take, setTake] = useState<Take | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canRetry = useMemo(
    () => Boolean(take) && !busy && progress.stage !== "completed",
    [busy, progress.stage, take],
  );

  const loadTake = useCallback(async () => {
    if (!localTakeId) return;
    const loaded = await takeRepoFs.getTake(localTakeId);
    if (!loaded) {
      setErrorMessage("Local take was not found.");
      return;
    }
    setTake(loaded);
  }, [localTakeId]);

  const startUpload = useCallback(
    async (sourceTake?: Take | null) => {
      const nextTake = sourceTake ?? take;
      if (!nextTake || busy) return;

      setBusy(true);
      setErrorMessage(null);
      setProgress(initialProgress);
      try {
        const result = await container.uploadManager.uploadTake({
          take: nextTake,
          onProgress: setProgress,
        });
        setTake(result.localTake);
        navigation.replace(routes.ProcessingStatus, {
          localTakeId: result.localTake.id,
          remoteProjectId: result.localTake.remote?.projectId,
          remoteTakeId: result.remoteTakeId,
          jobId: result.job.id,
        });
      } catch (error: any) {
        const message = error?.message ?? "Upload failed";
        setErrorMessage(message);
        setProgress((current) => ({
          ...current,
          stage: "failed",
          message,
        }));
      } finally {
        setBusy(false);
      }
    },
    [busy, navigation, take],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!localTakeId) {
        setErrorMessage("Missing take id.");
        return;
      }
      const loaded = await takeRepoFs.getTake(localTakeId);
      if (!active) return;
      if (!loaded) {
        setErrorMessage("Local take was not found.");
        return;
      }
      setTake(loaded);
      void startUpload(loaded);
    })();

    return () => {
      active = false;
      container.uploadManager.cancel();
    };
    // startUpload intentionally excluded so the initial auto-start runs once per route id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTakeId]);

  const onRetry = useCallback(async () => {
    await loadTake();
    const refreshed = localTakeId ? await takeRepoFs.getTake(localTakeId) : take;
    void startUpload(refreshed);
  }, [loadTake, localTakeId, startUpload, take]);

  const onCancel = useCallback(() => {
    container.uploadManager.cancel();
    Alert.alert("Upload cancelled", "The local recording is still saved on this device.");
    navigation.goBack();
  }, [navigation]);

  return (
    <Screen scroll background={errorMessage ? "danger" : "accent"} contentContainerStyle={styles.container}>
      <ScreenHeader
        eyebrow="Backend Capture"
        title="Uploading production source"
        subtitle="Original video and capture metadata are sent separately, then the backend processing job is created."
        right={<Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />}
      />

      <Card tone={errorMessage ? "danger" : "accent"} style={styles.card}>
        <View style={styles.progressHeader}>
          <View>
            <Text style={styles.stage}>{stageTitle(progress.stage)}</Text>
            <Text style={styles.message}>{errorMessage ?? progress.message}</Text>
          </View>
          <Text style={styles.percent}>{formatPercent(progress.progress)}</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: progressWidth(progress.progress) }]} />
        </View>
        <Text style={styles.meta}>
          attempt {progress.attempt}
          {progress.remoteTakeId ? ` · ${progress.remoteTakeId}` : ""}
        </Text>
      </Card>

      <Card tone="muted" style={styles.card}>
        <Text style={styles.label}>Source</Text>
        <Text style={styles.title}>{take?.name ?? "Loading take"}</Text>
        <Text style={styles.meta}>
          {take?.video
            ? `${Math.round(take.video.durationMs / 1000)}s · ${take.video.width}x${take.video.height} · ${take.video.container.toUpperCase()}`
            : "Waiting for local video metadata"}
        </Text>
        <Text style={styles.meta}>
          quality {take?.qualityScore ?? 0}% · schema {take?.captureMetadata?.schema ?? "-"}
        </Text>
      </Card>

      {errorMessage ? (
        <Card tone="danger" style={styles.card}>
          <Text style={styles.label}>Recovery</Text>
          <Text style={styles.message}>
            Upload can be retried with a fresh signed URL. The original capture remains local.
          </Text>
          <Button
            label="Retry upload"
            disabled={!canRetry}
            loading={busy}
            onPress={onRetry}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingBottom: spacing["3xl"],
  },
  card: {
    gap: spacing.sm,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  stage: {
    ...typography.title.card,
    color: colors.textPrimary,
  },
  title: {
    ...typography.title.card,
    color: colors.textPrimary,
  },
  label: {
    ...typography.label.md,
    color: colors.textMuted,
  },
  message: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
  percent: {
    ...typography.title.card,
    color: colors.accent,
  },
  track: {
    height: 10,
    borderRadius: radii.pill,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  fill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  meta: {
    ...typography.mono.sm,
    color: colors.textMuted,
  },
});
