import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { container } from "../../../app/di/container";
import { routes } from "../../../app/navigation/routes";
import type { ApiExportFile, ApiProcessingJob } from "../../../infra/api/MocapApiClient";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";

type RouteParams = {
  localTakeId?: string;
  remoteTakeId?: string;
  jobId?: string;
};

type Nav = any;

type QualityReport = {
  schema: "mocap.quality_report.v1";
  score: number;
  grade: "excellent" | "good" | "usable" | "poor" | "failed";
  summary: string;
  metrics: Record<string, number>;
  warnings: string[];
  errors: string[];
  actions: Array<{ code: string; severity: string; message: string }>;
  validation?: {
    exportOk: boolean;
    blenderOk: boolean;
    blenderSkipped: boolean;
  };
  reconstruction?: {
    source: "single_camera" | "dual_camera" | "multi_view";
    syncOffsetMs?: number;
    reprojectionErrorPx?: number;
    triangulatedLandmarkRatio?: number;
    qualityGain?: number;
    cameraCount?: number;
    placementQualityScore?: number;
    occlusionRecoveryRatio?: number;
  };
};

type PreviewSummary = {
  schema: "mocap.preview_summary.v1";
  fps: number;
  durationMs: number;
  frameCount: number;
  qualityScore: number;
  rootTravel: number;
  contactFrames: number;
  warnings: string[];
};

type DualReconstruction = {
  schema: "mocap.dual_reconstruction.v1";
  sync: {
    method: string;
    offsetMs: number;
    confidence: number;
    matchedFrameCount: number;
    averageTimeDeltaMs: number;
  };
  calibration: {
    convergenceAngleDeg: number;
    qualityScore: number;
  };
  quality: {
    singleCameraBaselineScore: number;
    dualQualityScore: number;
    qualityGain: number;
    averageReprojectionErrorPx: number;
    reprojectionP95Px: number;
    triangulatedLandmarkRatio: number;
    fallbackLandmarkRatio: number;
  };
  warnings: string[];
};

type MultiViewReconstruction = {
  schema: "mocap.multi_view_reconstruction.v1";
  cameraCount: number;
  cameras: Array<{
    deviceIndex: number;
    deviceRole: string;
    approxAngleDeg: number;
    placementScore: number;
    placementFeedback: string[];
  }>;
  sync: {
    matchedFrameCount: number;
    averageTimeDeltaMs: number;
  };
  calibration: {
    placementQualityScore: number;
    coverageScore: number;
    observedAnglesDeg: number[];
    warnings: string[];
  };
  occlusionRecovery: {
    recoveredLandmarkCount: number;
    temporalHoldCount: number;
    recoveryRatio: number;
  };
  quality: {
    multiViewQualityScore: number;
    qualityGain: number;
    averageReprojectionErrorPx: number;
    triangulatedLandmarkRatio: number;
    averageViewCount: number;
    matchedViewCoverage: number;
    placementQualityScore: number;
    occlusionRecoveryRatio: number;
  };
  warnings: string[];
};

const PRESETS = [
  { id: "humanoid_bvh_v1", label: "Humanoid BVH" },
  { id: "humanoid_bvh_quality_v1_5", label: "Quality V1.5" },
  { id: "humanoid_bvh_dual_v1", label: "Dual Camera" },
  { id: "humanoid_bvh_pro_4_camera_v1", label: "Pro 4 Cam" },
  { id: "humanoid_bvh_fast_preview", label: "Fast Preview" },
] as const;

function formatBytes(bytes: number | null) {
  if (!bytes || bytes <= 0) return "size pending";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(format: string) {
  return format.replace(/_/g, " ").toUpperCase();
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function metricPercent(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

async function readExportJson<T>(file: ApiExportFile): Promise<T> {
  const signed = await container.exportService.getDownloadUrl(file.id);
  const response = await fetch(signed.downloadUrl);
  if (!response.ok) {
    throw new Error(`Could not load ${file.format}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export default function ExportResultScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params = route?.params as RouteParams | undefined;
  const remoteTakeId = params?.remoteTakeId;

  const [exports, setExports] = useState<readonly ApiExportFile[]>([]);
  const [job, setJob] = useState<ApiProcessingJob | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [dualReconstruction, setDualReconstruction] = useState<DualReconstruction | null>(null);
  const [multiViewReconstruction, setMultiViewReconstruction] =
    useState<MultiViewReconstruction | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>(PRESETS[1].id);
  const [busyExportId, setBusyExportId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const primary = useMemo(
    () =>
      exports.find((file) => file.format === "bvh") ??
      exports.find((file) => file.format === "solved_motion_json") ??
      exports[0],
    [exports],
  );

  const refresh = useCallback(async () => {
    if (!remoteTakeId) {
      setErrorMessage("Missing remote take id.");
      return;
    }
    try {
      const list = await container.exportService.listExports(remoteTakeId);
      setExports(list);
      if (params?.jobId) {
        const nextJob = await container.mocapSessionService.getJob(params.jobId);
        setJob(nextJob);
      }
      const qualityFile = list.find((file) => file.format === "quality_report_json");
      const previewFile = list.find((file) => file.format === "preview_summary_json");
      const dualFile = list.find((file) => file.format === "dual_reconstruction_json");
      const multiViewFile = list.find((file) => file.format === "multi_view_reconstruction_json");
      setQuality(qualityFile ? await readExportJson<QualityReport>(qualityFile) : null);
      setPreview(previewFile ? await readExportJson<PreviewSummary>(previewFile) : null);
      setDualReconstruction(dualFile ? await readExportJson<DualReconstruction>(dualFile) : null);
      setMultiViewReconstruction(
        multiViewFile ? await readExportJson<MultiViewReconstruction>(multiViewFile) : null,
      );
      setErrorMessage(null);
    } catch (error: any) {
      setErrorMessage(error?.message ?? "Could not load backend exports.");
    }
  }, [params?.jobId, remoteTakeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openExport = useCallback(async (file: ApiExportFile) => {
    setBusyExportId(file.id);
    try {
      const signed = await container.exportService.getDownloadUrl(file.id);
      const supported = await Linking.canOpenURL(signed.downloadUrl);
      if (!supported) {
        Alert.alert("Download URL", signed.downloadUrl);
        return;
      }
      await Linking.openURL(signed.downloadUrl);
    } catch (error: any) {
      Alert.alert("Download failed", error?.message ?? "Could not open export URL.");
    } finally {
      setBusyExportId(null);
    }
  }, []);

  const shareExport = useCallback(async (file: ApiExportFile) => {
    setBusyExportId(file.id);
    try {
      const signed = await container.exportService.getDownloadUrl(file.id);
      await Share.share({
        message: signed.downloadUrl,
        url: signed.downloadUrl,
        title: formatLabel(file.format),
      });
    } catch (error: any) {
      Alert.alert("Share failed", error?.message ?? "Could not share export URL.");
    } finally {
      setBusyExportId(null);
    }
  }, []);

  const startReprocess = useCallback(async () => {
    if (!remoteTakeId || reprocessing) return;
    setReprocessing(true);
    try {
      const nextJob = await container.mocapSessionService.createProcessingJob(
        remoteTakeId,
        selectedPreset,
      );
      navigation.replace(routes.ProcessingStatus, {
        localTakeId: params?.localTakeId,
        remoteTakeId,
        jobId: nextJob.id,
      });
    } catch (error: any) {
      Alert.alert("Reprocess failed", error?.message ?? "Could not start processing.");
    } finally {
      setReprocessing(false);
    }
  }, [navigation, params?.localTakeId, remoteTakeId, reprocessing, selectedPreset]);

  return (
    <Screen scroll background={errorMessage ? "danger" : "accent"} contentContainerStyle={styles.container}>
      <ScreenHeader
        eyebrow="Result"
        title={quality ? `${quality.score}% ${quality.grade}` : "Backend exports are ready"}
        subtitle={quality?.summary ?? "Files below are generated by the backend worker from the uploaded source video."}
        right={<Button label="Refresh" variant="ghost" size="sm" onPress={refresh} />}
      />

      <Card tone="accent" style={styles.card}>
        <Text style={styles.label}>Primary handoff</Text>
        <Text style={styles.title}>{primary ? formatLabel(primary.format) : "Waiting"}</Text>
        <Text style={styles.message}>
          {primary
            ? `${formatBytes(primary.fileSizeBytes)} · ${new Date(primary.createdAt).toLocaleString()}`
            : "Export indexing has not completed yet."}
        </Text>
        {primary ? (
          <View style={styles.buttonRow}>
            <Button
              label="Download primary"
              loading={busyExportId === primary.id}
              onPress={() => openExport(primary)}
            />
            <Button
              label="Share"
              variant="secondary"
              loading={busyExportId === primary.id}
              onPress={() => shareExport(primary)}
            />
          </View>
        ) : null}
      </Card>

      {preview ? (
        <Card tone="default" style={styles.card}>
          <View style={styles.listHeader}>
            <Text style={styles.label}>Preview</Text>
            <Text style={styles.meta}>{preview.frameCount} frames</Text>
          </View>
          <View style={styles.previewStrip}>
            <PreviewBar label="duration" value={formatDuration(preview.durationMs)} />
            <PreviewBar label="fps" value={preview.fps.toFixed(1)} />
            <PreviewBar label="root travel" value={`${preview.rootTravel.toFixed(1)}u`} />
            <PreviewBar label="contact" value={String(preview.contactFrames)} />
          </View>
        </Card>
      ) : null}

      {quality ? (
        <Card tone={quality.errors.length ? "danger" : "accent"} style={styles.card}>
          <View style={styles.listHeader}>
            <Text style={styles.label}>Quality</Text>
            <Text style={styles.score}>{quality.score}%</Text>
          </View>
          <View style={styles.metricGrid}>
            <QualityMetric label="jitter" value={metricPercent(quality.metrics.jitterScore)} />
            <QualityMetric label="foot sliding" value={metricPercent(quality.metrics.footSlidingScore)} />
            <QualityMetric label="bone length" value={metricPercent(quality.metrics.boneLengthConsistency)} />
            <QualityMetric label="root stability" value={metricPercent(quality.metrics.rootStability)} />
          </View>
          <Text style={styles.meta}>
            Blender {quality.validation?.blenderSkipped ? "skipped" : quality.validation?.blenderOk ? "passed" : "check"} · export {quality.validation?.exportOk ? "valid" : "failed"}
          </Text>
          {quality.actions.slice(0, 4).map((action) => (
            <View key={`${action.code}-${action.message}`} style={styles.actionItem}>
              <Text style={styles.actionSeverity}>{action.severity.toUpperCase()}</Text>
              <Text style={styles.actionText}>{action.message}</Text>
            </View>
          ))}
          {quality.warnings.slice(0, 3).map((warning) => (
            <Text key={warning} style={styles.warningText}>{warning}</Text>
          ))}
        </Card>
      ) : null}

      {dualReconstruction || quality?.reconstruction?.source === "dual_camera" ? (
        <Card tone="default" style={styles.card}>
          <View style={styles.listHeader}>
            <Text style={styles.label}>Dual Camera Solve</Text>
            <Text style={styles.meta}>
              {dualReconstruction?.sync.method ?? "dual"} sync
            </Text>
          </View>
          <View style={styles.metricGrid}>
            <QualityMetric
              label="sync offset"
              value={`${Math.round(
                dualReconstruction?.sync.offsetMs ??
                  quality?.reconstruction?.syncOffsetMs ??
                  0,
              )}ms`}
            />
            <QualityMetric
              label="reprojection"
              value={`${(
                dualReconstruction?.quality.averageReprojectionErrorPx ??
                quality?.reconstruction?.reprojectionErrorPx ??
                0
              ).toFixed(1)}px`}
            />
            <QualityMetric
              label="triangulated"
              value={metricPercent(
                dualReconstruction?.quality.triangulatedLandmarkRatio ??
                  quality?.reconstruction?.triangulatedLandmarkRatio,
              )}
            />
            <QualityMetric
              label="gain"
              value={`+${Math.max(
                0,
                Math.round(
                  dualReconstruction?.quality.qualityGain ??
                    quality?.reconstruction?.qualityGain ??
                    0,
                ),
              )}`}
            />
          </View>
          {dualReconstruction ? (
            <Text style={styles.meta}>
              matched {dualReconstruction.sync.matchedFrameCount} frames · calibration{" "}
              {metricPercent(dualReconstruction.calibration.qualityScore)}
            </Text>
          ) : null}
          {dualReconstruction?.warnings.slice(0, 3).map((warning) => (
            <Text key={warning} style={styles.warningText}>{warning}</Text>
          ))}
        </Card>
      ) : null}

      {multiViewReconstruction || quality?.reconstruction?.source === "multi_view" ? (
        <Card tone="accent" style={styles.card}>
          <View style={styles.listHeader}>
            <Text style={styles.label}>Pro Multi-View Solve</Text>
            <Text style={styles.meta}>
              {multiViewReconstruction?.cameraCount ??
                quality?.reconstruction?.cameraCount ??
                4} cameras
            </Text>
          </View>
          <View style={styles.metricGrid}>
            <QualityMetric
              label="placement"
              value={metricPercent(
                multiViewReconstruction?.quality.placementQualityScore ??
                  quality?.reconstruction?.placementQualityScore,
              )}
            />
            <QualityMetric
              label="coverage"
              value={metricPercent(multiViewReconstruction?.quality.matchedViewCoverage)}
            />
            <QualityMetric
              label="occlusion"
              value={metricPercent(
                multiViewReconstruction?.quality.occlusionRecoveryRatio ??
                  quality?.reconstruction?.occlusionRecoveryRatio,
              )}
            />
            <QualityMetric
              label="gain"
              value={`+${Math.max(
                0,
                Math.round(
                  multiViewReconstruction?.quality.qualityGain ??
                    quality?.reconstruction?.qualityGain ??
                    0,
                ),
              )}`}
            />
          </View>
          <Text style={styles.meta}>
            reprojection{" "}
            {(
              multiViewReconstruction?.quality.averageReprojectionErrorPx ??
              quality?.reconstruction?.reprojectionErrorPx ??
              0
            ).toFixed(1)}
            px · triangulated{" "}
            {metricPercent(
              multiViewReconstruction?.quality.triangulatedLandmarkRatio ??
                quality?.reconstruction?.triangulatedLandmarkRatio,
            )}
          </Text>
          {multiViewReconstruction?.cameras.slice(0, 4).map((camera) => (
            <Text key={camera.deviceIndex} style={styles.meta}>
              {camera.deviceRole} · {Math.round(camera.approxAngleDeg)}deg ·{" "}
              {metricPercent(camera.placementScore)}
            </Text>
          ))}
          {[
            ...(multiViewReconstruction?.calibration.warnings ?? []),
            ...(multiViewReconstruction?.warnings ?? []),
          ].slice(0, 4).map((warning) => (
            <Text key={warning} style={styles.warningText}>{warning}</Text>
          ))}
        </Card>
      ) : null}

      {errorMessage ? (
        <Card tone="danger" style={styles.card}>
          <Text style={styles.label}>Issue</Text>
          <Text style={styles.message}>{errorMessage}</Text>
        </Card>
      ) : null}

      {job?.state === "failed" ? (
        <Card tone="danger" style={styles.card}>
          <Text style={styles.label}>Processing error</Text>
          <Text style={styles.message}>{job.message ?? job.errorCode ?? "Processing failed."}</Text>
          <Button
            label="Retry failed job"
            loading={reprocessing}
            onPress={async () => {
              if (!job.id || reprocessing) return;
              setReprocessing(true);
              try {
                const nextJob = await container.mocapSessionService.retryJob(job.id);
                navigation.replace(routes.ProcessingStatus, {
                  localTakeId: params?.localTakeId,
                  remoteTakeId: nextJob.takeId,
                  jobId: nextJob.id,
                });
              } catch (error: any) {
                Alert.alert("Retry failed", error?.message ?? "Could not retry job.");
              } finally {
                setReprocessing(false);
              }
            }}
          />
        </Card>
      ) : null}

      <Card tone="muted" style={styles.card}>
        <Text style={styles.label}>Reprocess preset</Text>
        <View style={styles.presetRow}>
          {PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => setSelectedPreset(preset.id)}
              style={[
                styles.presetChip,
                selectedPreset === preset.id ? styles.presetChipActive : null,
              ]}
            >
              <Text style={styles.presetText}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>
        <Button
          label="Reprocess"
          variant="secondary"
          loading={reprocessing}
          disabled={!remoteTakeId}
          onPress={startReprocess}
        />
      </Card>

      <Card tone="muted" style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.label}>Artifacts</Text>
          <Text style={styles.meta}>{exports.length} files</Text>
        </View>
        {exports.map((file) => (
          <Pressable
            key={file.id}
            onPress={() => openExport(file)}
            style={({ pressed }) => [
              styles.exportRow,
              pressed ? styles.exportRowPressed : null,
            ]}
          >
            <View style={styles.exportCopy}>
              <Text style={styles.exportTitle}>{formatLabel(file.format)}</Text>
              <Text style={styles.meta}>
                {file.preset} · {formatBytes(file.fileSizeBytes)}
              </Text>
            </View>
            <Text style={styles.download}>
              {busyExportId === file.id ? "..." : "OPEN"}
            </Text>
          </Pressable>
        ))}
        {exports.length === 0 ? (
          <Text style={styles.message}>No export files returned yet.</Text>
        ) : null}
      </Card>

      <View style={styles.actions}>
        {params?.localTakeId ? (
          <Button
            label="Review local"
            variant="secondary"
            onPress={() =>
              navigation.navigate(routes.Review, { takeId: params.localTakeId })
            }
          />
        ) : null}
        <Button
          label="Back to capture"
          variant="ghost"
          onPress={() => navigation.navigate("Tabs", { screen: routes.Capture })}
        />
      </View>
    </Screen>
  );
}

function PreviewBar({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewBar}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
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
  label: {
    ...typography.label.md,
    color: colors.textMuted,
  },
  title: {
    ...typography.title.card,
    color: colors.textPrimary,
  },
  message: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.mono.sm,
    color: colors.textMuted,
  },
  score: {
    ...typography.title.card,
    color: colors.accent,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  previewStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  previewBar: {
    minWidth: 132,
    flexGrow: 1,
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  previewValue: {
    ...typography.label.lg,
    color: colors.textPrimary,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    minWidth: 132,
    flexGrow: 1,
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  metricValue: {
    ...typography.label.lg,
    color: colors.textPrimary,
  },
  actionItem: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  actionSeverity: {
    ...typography.label.sm,
    color: colors.warning,
  },
  actionText: {
    ...typography.body.sm,
    color: colors.textSecondary,
  },
  warningText: {
    ...typography.body.sm,
    color: colors.warning,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  presetChip: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  presetChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  presetText: {
    ...typography.label.sm,
    color: colors.textPrimary,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  exportRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  exportRowPressed: {
    transform: [{ scale: 0.99 }],
  },
  exportCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  exportTitle: {
    ...typography.label.md,
    color: colors.textPrimary,
  },
  download: {
    ...typography.label.sm,
    color: colors.accent,
  },
  actions: {
    gap: spacing.sm,
  },
});
