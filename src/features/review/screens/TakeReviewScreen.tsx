import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { env } from "../../../app/config/env";
import type { Take, TakeReview } from "../../../domain/mocap/models/Take";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import { analyzeTakeReview } from "../../../domain/mocap/pipeline/review/TakeReviewAnalyzer";
import { readTakeFrames, readTakeMeta } from "../../../infra/persistence/takeRepoFs.reader";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { routes } from "../../../app/navigation/routes";
import { OverlaySkeleton } from "../../capture/components/OverlaySkeleton";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";

type Nav = any;
type RouteParams = {
  takeId?: string;
};

type ReviewMode = "raw" | "cleaned";
type ReviewStatus = TakeReview["status"];

const PLAYBACK_SPEEDS = [0.5, 1, 1.5];

function clampFrame(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

function formatDuration(ms: number) {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatFrameTime(frameIndex: number, fps: number) {
  if (fps <= 0) return `F${frameIndex}`;
  const seconds = frameIndex / fps;
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  const frames = Math.round((seconds - whole) * fps);
  return `${minutes}:${remainder.toString().padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function statusTone(status: ReviewStatus) {
  switch (status) {
    case "approved":
      return "accent" as const;
    case "needs-work":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

function statusLabel(status: ReviewStatus) {
  switch (status) {
    case "approved":
      return "Approved";
    case "needs-work":
      return "Needs work";
    default:
      return "Pending review";
  }
}

export default function TakeReviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params = route.params as RouteParams | undefined;
  const takeId = params?.takeId ?? "";

  const [take, setTake] = useState<Take | null>(null);
  const [frames, setFrames] = useState<PoseFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [selectedMode, setSelectedMode] = useState<ReviewMode>("cleaned");
  const [trimStartFrame, setTrimStartFrame] = useState(0);
  const [trimEndFrame, setTrimEndFrame] = useState(0);
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [note, setNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("pending");
  const [timelineWidth, setTimelineWidth] = useState(0);

  const load = useCallback(async () => {
    if (!takeId) return;
    setLoading(true);
    try {
      const [meta, takeFrames] = await Promise.all([
        readTakeMeta(takeId),
        readTakeFrames(takeId),
      ]);
      const initial = analyzeTakeReview(meta, takeFrames);
      const start =
        meta.review?.trimStartFrame ?? initial.cleanup.trimmedStartFrames;
      const end =
        meta.review?.trimEndFrame ??
        Math.max(0, takeFrames.length - 1 - initial.cleanup.trimmedEndFrames);

      setTake(meta);
      setFrames(takeFrames);
      setTrimStartFrame(start);
      setTrimEndFrame(end);
      setPlayheadFrame(start);
      setSelectedMode(meta.review?.selectedMode ?? "cleaned");
      setNote(meta.review?.note ?? "");
      setReviewStatus(meta.review?.status ?? "pending");
    } catch (error: any) {
      Alert.alert("Review load failed", error?.message ?? "Take data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [takeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const workingTake = useMemo(() => {
    if (!take) return null;
    const maxIndex = Math.max(0, frames.length - 1);
    return {
      ...take,
      review: {
        status: reviewStatus,
        trimStartFrame: clampFrame(trimStartFrame, maxIndex),
        trimEndFrame: clampFrame(Math.max(trimStartFrame, trimEndFrame), maxIndex),
        selectedMode,
        issueCount: take.review?.issueCount ?? 0,
        qualityScore: take.review?.qualityScore ?? take.qualityScore ?? 0,
        note: note.trim() || undefined,
        reviewedAt: take.review?.reviewedAt ?? 0,
      },
    } as Take;
  }, [frames.length, note, reviewStatus, selectedMode, take, trimEndFrame, trimStartFrame]);

  const analysis = useMemo(() => {
    if (!workingTake) return null;
    return analyzeTakeReview(workingTake, frames);
  }, [frames, workingTake]);

  const fps = useMemo(() => {
    if (!take) return 30;
    return take.avgFps > 0 ? take.avgFps : 30;
  }, [take]);

  useEffect(() => {
    if (!analysis) return;
    const maxIndex = Math.max(0, analysis.rawFrames.length - 1);
    const safeStart = clampFrame(trimStartFrame, maxIndex);
    const safeEnd = clampFrame(Math.max(safeStart, trimEndFrame), maxIndex);

    if (safeStart !== trimStartFrame) setTrimStartFrame(safeStart);
    if (safeEnd !== trimEndFrame) setTrimEndFrame(safeEnd);
    if (playheadFrame < safeStart || playheadFrame > safeEnd) {
      setPlayheadFrame(safeStart);
    }
  }, [analysis, playheadFrame, trimEndFrame, trimStartFrame]);

  useEffect(() => {
    if (!analysis || !isPlaying) return;
    const delay = Math.max(18, 1000 / (fps * playbackRate));

    const timer = setInterval(() => {
      setPlayheadFrame((current) => {
        if (current >= trimEndFrame) {
          if (loopPlayback) {
            return trimStartFrame;
          }
          setIsPlaying(false);
          return current;
        }
        return Math.min(trimEndFrame, current + 1);
      });
    }, delay);

    return () => clearInterval(timer);
  }, [analysis, fps, isPlaying, loopPlayback, playbackRate, trimEndFrame, trimStartFrame]);

  const displayFrame = useMemo(() => {
    if (!analysis) return undefined;
    const rawIndex = clampFrame(playheadFrame, Math.max(0, analysis.rawFrames.length - 1));
    if (selectedMode === "raw") {
      return analysis.rawFrames[rawIndex];
    }
    const cleanedIndex = clampFrame(
      rawIndex - analysis.cleanup.trimmedStartFrames,
      Math.max(0, analysis.cleanedFrames.length - 1),
    );
    return analysis.cleanedFrames[cleanedIndex] ?? analysis.rawFrames[rawIndex];
  }, [analysis, playheadFrame, selectedMode]);

  const trimmedFrameCount = Math.max(0, trimEndFrame - trimStartFrame + 1);
  const playheadTimeLabel = formatFrameTime(playheadFrame, fps);
  const trimmedDuration = formatDuration((trimmedFrameCount / Math.max(fps, 1)) * 1000);

  const saveReview = useCallback(
    async (nextStatus?: ReviewStatus, openExport?: boolean) => {
      if (!take || !analysis) return;

      const review: TakeReview = {
        status: nextStatus ?? reviewStatus,
        trimStartFrame,
        trimEndFrame,
        selectedMode,
        issueCount: analysis.issueFrames.length,
        qualityScore: analysis.qualityScore,
        note: note.trim() || undefined,
        reviewedAt: Date.now(),
      };

      setSaving(true);
      try {
        const updated = await takeRepoFs.updateTakeMeta(take.id, {
          calibration: analysis.calibration,
          postProcess: analysis.cleanup,
          retarget: analysis.retarget,
          review,
          qualityScore: analysis.qualityScore,
        });

        setTake(updated);
        setReviewStatus(review.status);

        if (openExport) {
          if (updated.remote?.status === "completed" && updated.remote.takeId) {
            navigation.navigate(routes.ExportResult, {
              localTakeId: updated.id,
              remoteTakeId: updated.remote.takeId,
              jobId: updated.remote.jobId,
            });
            return;
          }
          if (updated.remote?.jobId) {
            navigation.navigate(routes.ProcessingStatus, {
              localTakeId: updated.id,
              remoteTakeId: updated.remote.takeId,
              jobId: updated.remote.jobId,
            });
            return;
          }
          if (updated.video && updated.captureMetadata) {
            navigation.navigate(routes.UploadProgress, { takeId: updated.id });
            return;
          }
          if (env.enableLocalDebugExport) {
            navigation.navigate(routes.Export, { takeId: take.id });
            return;
          }
          Alert.alert(
            "Export not ready",
            "This take does not have a backend-ready video capture.",
          );
          return;
        }

        Alert.alert("Review saved", "Playback and trim decisions were saved.");
      } catch (error: any) {
        Alert.alert("Save failed", error?.message ?? "Review could not be saved.");
      } finally {
        setSaving(false);
      }
    },
    [
      analysis,
      navigation,
      note,
      reviewStatus,
      selectedMode,
      take,
      trimEndFrame,
      trimStartFrame,
    ],
  );

  const handleTimelinePress = useCallback(
    (locationX: number) => {
      if (!analysis || timelineWidth <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / timelineWidth));
      const next = Math.round(ratio * Math.max(0, analysis.rawFrames.length - 1));
      setPlayheadFrame(next);
      setIsPlaying(false);
    },
    [analysis, timelineWidth],
  );

  if (loading) {
    return (
      <Screen background="accent" contentContainerStyle={styles.loader}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loaderText}>Loading take review...</Text>
      </Screen>
    );
  }

  if (!take || !analysis || frames.length === 0) {
    const canOpenBackend = Boolean(take?.video && take.captureMetadata);
    const backendLabel =
      take?.remote?.status === "completed"
        ? "Open result"
        : take?.remote?.jobId
          ? "Open status"
          : "Upload source";
    return (
      <Screen scroll background="danger" contentContainerStyle={styles.content}>
        <ScreenHeader
          eyebrow="Take Review"
          title={canOpenBackend ? "Production source captured." : "No take data found."}
          subtitle={
            canOpenBackend
              ? "This production capture has video and metadata but no local debug frame chunks. Continue through the backend result flow."
              : "This session does not have readable frame data yet."
          }
          right={
            <Button label="Back" variant="ghost" size="sm" onPress={() => navigation.goBack()} />
          }
        />
        {canOpenBackend ? (
          <Card tone="accent" style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{take?.name}</Text>
            <Text style={styles.emptyFinding}>
              {Math.round((take?.video?.durationMs ?? 0) / 1000)}s source video · quality {take?.qualityScore ?? 0}%
            </Text>
            <Button
              label={backendLabel}
              onPress={() => {
                if (take?.remote?.status === "completed" && take.remote.takeId) {
                  navigation.navigate(routes.ExportResult, {
                    localTakeId: take.id,
                    remoteTakeId: take.remote.takeId,
                    jobId: take.remote.jobId,
                  });
                  return;
                }
                if (take?.remote?.jobId) {
                  navigation.navigate(routes.ProcessingStatus, {
                    localTakeId: take.id,
                    remoteTakeId: take.remote.takeId,
                    jobId: take.remote.jobId,
                  });
                  return;
                }
                navigation.navigate(routes.UploadProgress, { takeId: take?.id });
              }}
            />
          </Card>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen scroll background="accent" contentContainerStyle={styles.content}>
      <ScreenHeader
        eyebrow="Take Review"
        title={take.name}
        subtitle="Inspect motion quality, compare raw and cleaned solve, trim the usable range, and approve the take before export."
        right={
          <Button label="Back" variant="ghost" size="sm" onPress={() => navigation.goBack()} />
        }
      />

      <View style={styles.metricsRow}>
        <MetricCard label="Review score" value={`${analysis.qualityScore}%`} accent={colors.accent} />
        <MetricCard label="Trimmed range" value={`${trimmedFrameCount}f`} accent={colors.info} />
        <MetricCard
          label="Retarget"
          value={analysis.retarget.ready ? "Ready" : "Check"}
          accent={analysis.retarget.ready ? colors.success : colors.warning}
        />
        <MetricCard
          label="Status"
          value={statusLabel(reviewStatus)}
          accent={
            reviewStatus === "approved"
              ? colors.success
              : reviewStatus === "needs-work"
                ? colors.danger
                : colors.warning
          }
        />
      </View>

      <Card tone={statusTone(reviewStatus)} padding="sm" style={styles.stageCard}>
        <View style={styles.stageHeader}>
          <View style={styles.stageCopy}>
            <Text style={styles.stageTitle}>Playback stage</Text>
            <Text style={styles.stageMeta}>
              {selectedMode === "raw" ? "Raw solve" : "Cleaned solve"}  •  {playheadTimeLabel}
            </Text>
          </View>
          <View style={styles.modeRow}>
            <ModeChip
              label="RAW"
              active={selectedMode === "raw"}
              onPress={() => setSelectedMode("raw")}
            />
            <ModeChip
              label="CLEAN"
              active={selectedMode === "cleaned"}
              onPress={() => setSelectedMode("cleaned")}
            />
          </View>
        </View>

        <View
          style={styles.stageSurface}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setStageSize({ width, height });
          }}
        >
          <View style={styles.stageGrid} />
          <OverlaySkeleton
            width={stageSize.width}
            height={stageSize.height}
            frame={displayFrame}
          />
          <View pointerEvents="none" style={styles.stageOverlay}>
            <Text style={styles.stageOverlayText}>{statusLabel(reviewStatus)}</Text>
            <Text style={styles.stageOverlaySubtext}>
              Frame {playheadFrame + 1} / {analysis.rawFrames.length}
            </Text>
          </View>
        </View>

        <View style={styles.transportRow}>
          <Button
            label={isPlaying ? "Pause" : "Play"}
            variant={isPlaying ? "secondary" : "primary"}
            size="sm"
            onPress={() => setIsPlaying((current) => !current)}
          />
          <Button
            label="Prev"
            variant="ghost"
            size="sm"
            onPress={() => {
              setIsPlaying(false);
              setPlayheadFrame((current) => Math.max(trimStartFrame, current - 1));
            }}
          />
          <Button
            label="Next"
            variant="ghost"
            size="sm"
            onPress={() => {
              setIsPlaying(false);
              setPlayheadFrame((current) => Math.min(trimEndFrame, current + 1));
            }}
          />
          <Button
            label={loopPlayback ? "Loop on" : "Loop off"}
            variant={loopPlayback ? "success" : "ghost"}
            size="sm"
            onPress={() => setLoopPlayback((current) => !current)}
          />
        </View>

        <View style={styles.speedRow}>
          {PLAYBACK_SPEEDS.map((speed) => (
            <ModeChip
              key={speed}
              label={`${speed}x`}
              active={playbackRate === speed}
              onPress={() => setPlaybackRate(speed)}
            />
          ))}
        </View>

        <View style={styles.timelineMetaRow}>
          <Text style={styles.timelineMetaLabel}>{formatFrameTime(trimStartFrame, fps)}</Text>
          <Text style={styles.timelineMetaLabel}>{trimmedDuration}</Text>
          <Text style={styles.timelineMetaLabel}>{formatFrameTime(trimEndFrame, fps)}</Text>
        </View>

        <Pressable
          onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)}
          onPress={(event) => handleTimelinePress(event.nativeEvent.locationX)}
          style={styles.timeline}
        >
          <View style={styles.timelineTrack} />
          <View
            style={[
              styles.timelineSelection,
              {
                left: `${(trimStartFrame / Math.max(1, analysis.rawFrames.length - 1)) * 100}%`,
                width: `${((trimEndFrame - trimStartFrame + 1) / Math.max(1, analysis.rawFrames.length)) * 100}%`,
              },
            ]}
          />
          {analysis.issueFrames.slice(0, 60).map((frameIndex) => (
            <View
              key={`issue-${frameIndex}`}
              style={[
                styles.timelineIssue,
                {
                  left: `${(frameIndex / Math.max(1, analysis.rawFrames.length - 1)) * 100}%`,
                },
              ]}
            />
          ))}
          <View
            style={[
              styles.timelinePlayhead,
              {
                left: `${(playheadFrame / Math.max(1, analysis.rawFrames.length - 1)) * 100}%`,
              },
            ]}
          />
        </Pressable>

        <View style={styles.editRow}>
          <Button
            label="Set In"
            variant="secondary"
            size="sm"
            onPress={() => setTrimStartFrame(Math.min(playheadFrame, trimEndFrame))}
          />
          <Button
            label="Set Out"
            variant="secondary"
            size="sm"
            onPress={() => setTrimEndFrame(Math.max(playheadFrame, trimStartFrame))}
          />
          <Button
            label="Reset Trim"
            variant="ghost"
            size="sm"
            onPress={() => {
              setTrimStartFrame(0);
              setTrimEndFrame(Math.max(0, analysis.rawFrames.length - 1));
              setPlayheadFrame(0);
            }}
          />
        </View>
      </Card>

      <Card tone="default" style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Motion findings</Text>
        <View style={styles.findingsList}>
          {analysis.findings.length ? (
            analysis.findings.map((finding) => (
              <FindingRow
                key={finding.id}
                label={finding.label}
                description={finding.description}
                count={finding.count}
                severity={finding.severity}
              />
            ))
          ) : (
            <Text style={styles.emptyFinding}>
              No critical findings. The take is stable enough for approval.
            </Text>
          )}
        </View>
      </Card>

      <Card tone="default" style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Review notes and decision</Text>
        <View style={styles.decisionRow}>
          <ModeChip
            label="Pending"
            active={reviewStatus === "pending"}
            onPress={() => setReviewStatus("pending")}
          />
          <ModeChip
            label="Approve"
            active={reviewStatus === "approved"}
            onPress={() => setReviewStatus("approved")}
          />
          <ModeChip
            label="Needs work"
            active={reviewStatus === "needs-work"}
            onPress={() => setReviewStatus("needs-work")}
          />
        </View>

        <TextInput
          multiline
          value={note}
          onChangeText={setNote}
          placeholder="Reviewer note. Example: left wrist exits frame around the final beat."
          placeholderTextColor={colors.textMuted}
          style={styles.noteInput}
        />

        <View style={styles.reviewFooter}>
          <Text style={styles.reviewFooterText}>
            Trim {trimStartFrame + 1}-{trimEndFrame + 1}  •  {analysis.issueFrames.length} flagged frames  •  preset {analysis.retarget.preset}
          </Text>
        </View>

        <View style={styles.actionRow}>
          <Button
            label={saving ? "Saving..." : "Save draft"}
            variant="secondary"
            loading={saving}
            onPress={() => void saveReview()}
          />
          <Button
            label="Approve"
            variant="success"
            disabled={saving}
            onPress={() => void saveReview("approved")}
          />
          <Button
            label="Needs work"
            variant="danger"
            disabled={saving}
            onPress={() => void saveReview("needs-work")}
          />
          <Button
            label="Backend export"
            variant="primary"
            disabled={saving}
            onPress={() => void saveReview(reviewStatus, true)}
          />
        </View>
      </Card>
    </Screen>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricDot, { backgroundColor: accent }]} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ModeChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.modeChip, active ? styles.modeChipActive : styles.modeChipIdle]}
    >
      <Text style={styles.modeChipText}>{label}</Text>
    </Pressable>
  );
}

function FindingRow({
  label,
  description,
  count,
  severity,
}: {
  label: string;
  description: string;
  count: number;
  severity: "info" | "warn" | "critical";
}) {
  const color =
    severity === "critical"
      ? colors.danger
      : severity === "warn"
        ? colors.warning
        : colors.info;

  return (
    <View style={styles.findingRow}>
      <View style={[styles.findingStripe, { backgroundColor: color }]} />
      <View style={styles.findingCopy}>
        <View style={styles.findingTop}>
          <Text style={styles.findingLabel}>{label}</Text>
          <Text style={[styles.findingCount, { color }]}>{count}</Text>
        </View>
        <Text style={styles.findingDescription}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: {
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  loaderText: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
  content: {
    paddingBottom: 120,
    gap: spacing.md,
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    minWidth: 150,
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(13, 27, 41, 0.84)",
    borderWidth: 1,
    borderColor: colors.line,
    gap: spacing.xs,
  },
  metricDot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
  },
  metricLabel: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  metricValue: {
    ...typography.title.card,
  },
  stageCard: {
    gap: spacing.sm,
  },
  stageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  stageCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  stageTitle: {
    ...typography.title.card,
  },
  stageMeta: {
    ...typography.body.sm,
    color: colors.textMuted,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  modeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  modeChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  modeChipIdle: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderColor: colors.line,
  },
  modeChipText: {
    ...typography.label.sm,
    color: colors.textPrimary,
  },
  stageSurface: {
    minHeight: 420,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.backgroundDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stageGrid: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backgroundDeep,
    borderRadius: radii.lg,
    opacity: 0.65,
  },
  stageOverlay: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: "rgba(7, 12, 18, 0.7)",
    borderWidth: 1,
    borderColor: colors.line,
    gap: 2,
  },
  stageOverlayText: {
    ...typography.label.md,
  },
  stageOverlaySubtext: {
    ...typography.body.sm,
    color: colors.textMuted,
  },
  transportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  speedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  timelineMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  timelineMetaLabel: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  timeline: {
    height: 44,
    justifyContent: "center",
  },
  timelineTrack: {
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  timelineSelection: {
    position: "absolute",
    top: 17,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: "rgba(108, 242, 214, 0.28)",
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  timelineIssue: {
    position: "absolute",
    top: 10,
    width: 2,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.warning,
  },
  timelinePlayhead: {
    position: "absolute",
    top: 6,
    width: 2,
    height: 32,
    backgroundColor: colors.textPrimary,
  },
  editRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  sectionCard: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.title.card,
  },
  findingsList: {
    gap: spacing.sm,
  },
  findingRow: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: colors.line,
  },
  findingStripe: {
    width: 4,
    borderRadius: radii.pill,
  },
  findingCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  findingTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  findingLabel: {
    ...typography.label.md,
  },
  findingCount: {
    ...typography.label.sm,
  },
  findingDescription: {
    ...typography.body.sm,
    color: colors.textSecondary,
  },
  emptyFinding: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
  decisionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  noteInput: {
    minHeight: 118,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    textAlignVertical: "top",
    ...typography.body.md,
  },
  reviewFooter: {
    paddingHorizontal: spacing.xs,
  },
  reviewFooterText: {
    ...typography.body.sm,
    color: colors.textMuted,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
