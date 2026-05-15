import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type DimensionValue } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { container } from "../../../app/di/container";
import { routes } from "../../../app/navigation/routes";
import type { ApiExportFile, ApiProcessingJob, ProcessingJobState } from "../../../infra/api/MocapApiClient";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";

type RouteParams = {
  localTakeId?: string;
  remoteProjectId?: string;
  remoteTakeId?: string;
  jobId?: string;
};

type Nav = any;

const ACTIVE_STATES: ProcessingJobState[] = [
  "queued",
  "ingesting",
  "extracting_frames",
  "detecting_pose",
  "solving_motion",
  "cleaning",
  "exporting",
];

function statusCopy(state: ProcessingJobState | undefined) {
  switch (state) {
    case "queued":
      return { title: "Waiting in queue", label: "Queued" };
    case "ingesting":
      return { title: "Preparing video", label: "Ingest" };
    case "extracting_frames":
      return { title: "Extracting motion frames", label: "Frames" };
    case "detecting_pose":
      return { title: "Detecting body movement", label: "Pose" };
    case "solving_motion":
      return { title: "Solving skeleton", label: "Solve" };
    case "cleaning":
      return { title: "Cleaning animation", label: "Clean" };
    case "exporting":
      return { title: "Generating export", label: "Export" };
    case "succeeded":
      return { title: "Ready", label: "Done" };
    case "failed":
      return { title: "Processing failed", label: "Failed" };
    case "canceled":
      return { title: "Processing cancelled", label: "Cancelled" };
    default:
      return { title: "Loading job", label: "Status" };
  }
}

function progressFor(job: ApiProcessingJob | null) {
  if (!job) return 0;
  return Math.max(0, Math.min(1, job.progress / 100));
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function progressWidth(value: number): DimensionValue {
  return formatPercent(value) as DimensionValue;
}

export default function ProcessingStatusScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params = route?.params as RouteParams | undefined;
  const jobId = params?.jobId;
  const localTakeId = params?.localTakeId;
  const remoteProjectId = params?.remoteProjectId;
  const remoteTakeId = params?.remoteTakeId;
  const autoNavigatedRef = useRef(false);

  const [job, setJob] = useState<ApiProcessingJob | null>(null);
  const [exports, setExports] = useState<readonly ApiExportFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const copy = statusCopy(job?.state);
  const progress = progressFor(job);
  const active = job ? ACTIVE_STATES.includes(job.state) : true;
  const retryableTerminal =
    job?.state === "failed" || job?.state === "canceled";

  const updateLocal = useCallback(
    async (nextJob: ApiProcessingJob) => {
      if (!localTakeId || !remoteTakeId) return;
      const current = await takeRepoFs.getTake(localTakeId).catch(() => undefined);
      const status =
        nextJob.state === "succeeded"
          ? "completed"
          : nextJob.state === "failed"
            ? "failed"
            : nextJob.state === "canceled"
              ? "canceled"
              : "processing";
      await takeRepoFs.updateTakeMeta(localTakeId, {
        remote: {
          projectId: current?.remote?.projectId ?? remoteProjectId ?? "",
          takeId: remoteTakeId,
          uploadSessionId: current?.remote?.uploadSessionId,
          jobId: nextJob.id,
          status,
          progress: progressFor(nextJob),
          errorMessage: nextJob.message ?? nextJob.errorCode ?? undefined,
          updatedAt: Date.now(),
        },
      }).catch(() => undefined);
    },
    [localTakeId, remoteProjectId, remoteTakeId],
  );

  const refresh = useCallback(async () => {
    if (!jobId) {
      setErrorMessage("Missing processing job id.");
      return;
    }
    try {
      const nextJob = await container.mocapSessionService.getJob(jobId);
      setJob(nextJob);
      setErrorMessage(null);
      await updateLocal(nextJob);

      if (nextJob.state === "succeeded") {
        const list = await container.exportService.listExports(nextJob.takeId);
        setExports(list);
        if (list.length > 0 && !autoNavigatedRef.current) {
          autoNavigatedRef.current = true;
          navigation.replace(routes.ExportResult, {
            localTakeId,
            remoteTakeId: nextJob.takeId,
            jobId: nextJob.id,
          });
        }
      }
    } catch (error: any) {
      setErrorMessage(error?.message ?? "Could not refresh processing status.");
    }
  }, [jobId, localTakeId, navigation, remoteTakeId, updateLocal]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const onRetry = useCallback(async () => {
    if (!job?.id || busy) return;
    setBusy(true);
    try {
      const nextJob = await container.mocapSessionService.retryJob(job.id);
      setJob(nextJob);
      navigation.replace(routes.ProcessingStatus, {
        localTakeId,
        remoteTakeId: nextJob.takeId,
        remoteProjectId,
        jobId: nextJob.id,
      });
    } catch (error: any) {
      setErrorMessage(error?.message ?? "Retry failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, job?.id, localTakeId, navigation, remoteProjectId]);

  const onCancel = useCallback(async () => {
    if (!job?.id || busy) return;
    setBusy(true);
    try {
      const nextJob = await container.mocapSessionService.cancelJob(job.id);
      setJob(nextJob);
      await updateLocal(nextJob);
    } catch (error: any) {
      setErrorMessage(error?.message ?? "Cancel failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, job?.id, updateLocal]);

  const timelineCount = useMemo(() => job?.timeline?.length ?? 0, [job?.timeline]);

  return (
    <Screen
      scroll
      background={retryableTerminal ? "danger" : "accent"}
      contentContainerStyle={styles.container}
    >
      <ScreenHeader
        eyebrow="Processing"
        title={copy.title}
        subtitle="Backend worker turns uploaded video into pose frames, solved motion and export files."
        right={<Button label="Back" variant="ghost" size="sm" onPress={() => navigation.goBack()} />}
      />

      <Card tone={retryableTerminal ? "danger" : "accent"} style={styles.card}>
        <View style={styles.progressHeader}>
          <View>
            <Text style={styles.stage}>{copy.label}</Text>
            <Text style={styles.message}>{job?.message ?? errorMessage ?? "Waiting for worker update"}</Text>
          </View>
          <Text style={styles.percent}>{formatPercent(progress)}</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: progressWidth(progress) }]} />
        </View>
        <Text style={styles.meta}>
          {job?.id ?? jobId ?? "-"} · {timelineCount} events
        </Text>
      </Card>

      <Card tone="muted" style={styles.card}>
        <Text style={styles.label}>Pipeline</Text>
        <View style={styles.stepRow}>
          {ACTIVE_STATES.map((state) => (
            <View
              key={state}
              style={[
                styles.step,
                job?.state === state ? styles.stepActive : null,
                job?.state === "succeeded" ? styles.stepDone : null,
              ]}
            >
              <Text style={styles.stepText}>{statusCopy(state).label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {job?.state === "succeeded" ? (
        <Card tone="accent" style={styles.card}>
          <Text style={styles.label}>Result</Text>
          <Text style={styles.message}>
            {exports.length > 0
              ? `${exports.length} backend export files are ready.`
              : "Worker completed. Export files are being indexed."}
          </Text>
          <Button
            label="Open exports"
            onPress={() =>
              navigation.replace(routes.ExportResult, {
                localTakeId,
                remoteTakeId: job.takeId,
                jobId: job.id,
              })
            }
          />
        </Card>
      ) : null}

      {retryableTerminal ? (
        <Card tone="danger" style={styles.card}>
          <Text style={styles.label}>Recovery</Text>
          <Text style={styles.message}>
            The original upload remains in object storage. Retry creates a new worker job from the same source files.
          </Text>
          <Button label="Retry processing" loading={busy} onPress={onRetry} />
        </Card>
      ) : active ? (
        <Card tone="muted" style={styles.card}>
          <Text style={styles.label}>Controls</Text>
          <Button
            label="Cancel job"
            variant="secondary"
            loading={busy}
            onPress={onCancel}
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
    overflow: "hidden",
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  fill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  label: {
    ...typography.label.md,
    color: colors.textMuted,
  },
  meta: {
    ...typography.mono.sm,
    color: colors.textMuted,
  },
  stepRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  step: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  stepActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  stepDone: {
    borderColor: "rgba(132,247,181,0.28)",
    backgroundColor: colors.successSoft,
  },
  stepText: {
    ...typography.label.sm,
    color: colors.textPrimary,
  },
});
