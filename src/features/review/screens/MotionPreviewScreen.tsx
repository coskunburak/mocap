import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { routes } from "../../../app/navigation/routes";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import type { Take } from "../../../domain/mocap/models/Take";
import { analyzeTakeReview } from "../../../domain/mocap/pipeline/review/TakeReviewAnalyzer";
import { readTakeFrames, readTakeMeta } from "../../../infra/persistence/takeRepoFs.reader";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { Button } from "../../../ui/components/Button";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import { LiveAvatarViewer } from "../../capture/components/LiveAvatarViewer";
import { OverlaySkeleton } from "../../capture/components/OverlaySkeleton";

type Nav = any;
type RouteParams = {
  takeId?: string;
  continueBackend?: boolean;
};

type ScreenMode = "player" | "gallery";

type GalleryItem = {
  take: Take;
  subtitle: string;
  badge: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(ms: number) {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

function formatFrameTime(frameIndex: number, fps: number) {
  if (fps <= 0) return `F${frameIndex + 1}`;
  const seconds = frameIndex / fps;
  const wholeSeconds = Math.floor(seconds);
  const frames = Math.floor((seconds - wholeSeconds) * fps);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function takeBadge(take: Take) {
  if (take.remote?.status === "uploading") return "uploading";
  if (take.remote?.status === "processing") return "processing";
  if (take.remote?.status === "completed") return "ready";
  if (take.review?.status === "approved") return "approved";
  if (take.review?.status === "needs-work") return "check";
  return take.frameCount > 0 ? "captured" : "source";
}

function takeSubtitle(take: Take) {
  const parts = [
    take.frameCount > 0 ? `${take.frameCount} frames` : undefined,
    take.durationMs > 0 ? formatDuration(take.durationMs) : undefined,
    take.qualityScore != null ? `${take.qualityScore}% quality` : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(" / ") : "awaiting motion data";
}

function cameraSide(take: Take | null) {
  const name = take?.name.toLowerCase() ?? "";
  if (name.startsWith("front")) return "front";
  if (name.startsWith("back")) return "back";
  const role = take?.captureMetadata?.deviceRole;
  if (role === "front" || role === "back") return role;
  return "back";
}

function safeAnalyze(take: Take | null, frames: readonly PoseFrame[]) {
  if (!take || frames.length === 0) return null;
  try {
    return analyzeTakeReview(take, frames);
  } catch (error) {
    console.warn("[MotionPreviewScreen] analysis failed", error);
    return null;
  }
}

export default function MotionPreviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params = route.params as RouteParams | undefined;
  const insets = useSafeAreaInsets();

  const [selectedTakeId, setSelectedTakeId] = useState(params?.takeId ?? "");
  const [take, setTake] = useState<Take | null>(null);
  const [frames, setFrames] = useState<PoseFrame[]>([]);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [thumbnailFrames, setThumbnailFrames] = useState<Record<string, PoseFrame | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [mode, setMode] = useState<ScreenMode>("player");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (params?.takeId && params.takeId !== selectedTakeId) {
      setSelectedTakeId(params.takeId);
    }
  }, [params?.takeId, selectedTakeId]);

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      const allTakes = await takeRepoFs.listTakes();
      const recent = allTakes.slice(0, 12);
      setGalleryItems(
        recent.map((item) => ({
          take: item,
          subtitle: takeSubtitle(item),
          badge: takeBadge(item),
        })),
      );
      if (!selectedTakeId && recent[0]) {
        setSelectedTakeId(recent[0].id);
      }

      const pairs = await Promise.all(
        recent.slice(0, 9).map(async (item) => {
          try {
            const itemFrames = await readTakeFrames(item.id);
            const frame = itemFrames[Math.floor(itemFrames.length * 0.42)];
            return [item.id, frame] as const;
          } catch {
            return [item.id, undefined] as const;
          }
        }),
      );
      setThumbnailFrames(Object.fromEntries(pairs));
    } finally {
      setGalleryLoading(false);
    }
  }, [selectedTakeId]);

  const loadSelected = useCallback(async () => {
    if (!selectedTakeId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [meta, takeFrames] = await Promise.all([
        readTakeMeta(selectedTakeId),
        readTakeFrames(selectedTakeId),
      ]);
      setTake(meta);
      setFrames(takeFrames);
      setPlayhead(0);
      setPlaying(takeFrames.length > 1);
    } catch (error: any) {
      Alert.alert("Preview load failed", error?.message ?? "Motion preview could not be loaded.");
      setTake(null);
      setFrames([]);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [selectedTakeId]);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  const analysis = useMemo(() => safeAnalyze(take, frames), [frames, take]);
  const playbackFrames = useMemo(() => {
    if (analysis?.cleanedFrames.length) {
      return analysis.cleanedFrames;
    }
    return frames;
  }, [analysis, frames]);

  const fps = useMemo(() => {
    const raw = take?.avgFps && take.avgFps > 0 ? take.avgFps : take?.video?.fps;
    return raw && raw > 0 ? clamp(raw, 12, 60) : 30;
  }, [take]);

  const currentFrame = playbackFrames[clamp(playhead, 0, Math.max(0, playbackFrames.length - 1))];
  const progress =
    playbackFrames.length > 1 ? playhead / Math.max(1, playbackFrames.length - 1) : 0;
  const side = cameraSide(take);
  const canProcess = Boolean(take?.video && take.captureMetadata);
  const showProcessingHint =
    params?.continueBackend && canProcess && take?.remote?.status !== "completed";

  useEffect(() => {
    const maxFrame = Math.max(0, playbackFrames.length - 1);
    if (playhead > maxFrame) {
      setPlayhead(maxFrame);
    }
  }, [playbackFrames.length, playhead]);

  useEffect(() => {
    if (!playing || playbackFrames.length <= 1) return;
    const interval = setInterval(() => {
      setPlayhead((value) => (value >= playbackFrames.length - 1 ? 0 : value + 1));
    }, Math.max(16, 1000 / fps));

    return () => clearInterval(interval);
  }, [fps, playbackFrames.length, playing]);

  const openReview = useCallback(() => {
    if (!take) return;
    navigation.navigate(routes.Review, { takeId: take.id });
  }, [navigation, take]);

  const openExportFlow = useCallback(() => {
    if (!take) return;
    if (take.remote?.status === "completed" && take.remote.takeId) {
      navigation.navigate(routes.ExportResult, {
        localTakeId: take.id,
        remoteTakeId: take.remote.takeId,
        jobId: take.remote.jobId,
      });
      return;
    }
    if (take.remote?.jobId) {
      navigation.navigate(routes.ProcessingStatus, {
        localTakeId: take.id,
        remoteTakeId: take.remote.takeId,
        jobId: take.remote.jobId,
      });
      return;
    }
    if (canProcess) {
      navigation.navigate(routes.UploadProgress, { takeId: take.id });
      return;
    }
    navigation.navigate(routes.Export, { takeId: take.id });
  }, [canProcess, navigation, take]);

  const handleTimelinePress = useCallback(
    (locationX: number) => {
      if (timelineWidth <= 0 || playbackFrames.length <= 1) return;
      const next = Math.round(
        clamp(locationX / timelineWidth, 0, 1) * (playbackFrames.length - 1),
      );
      setPlayhead(next);
      setPlaying(false);
    },
    [playbackFrames.length, timelineWidth],
  );

  const selectGalleryTake = useCallback((id: string) => {
    setSelectedTakeId(id);
    setMode("player");
  }, []);

  if (loading && !take) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading motion preview...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {mode === "player" ? (
        <View style={styles.player}>
          <View
            style={styles.stage}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setStageSize({ width, height });
            }}
          >
            <View style={styles.stageBackdrop}>
              <View style={styles.backdropLineA} />
              <View style={styles.backdropLineB} />
              <View style={styles.backdropFloor} />
              <View style={styles.backdropGlow} />
            </View>
            <LiveAvatarViewer frame={currentFrame} />
            {stageSize.width > 0 && stageSize.height > 0 ? (
              <View pointerEvents="none" style={styles.skeletonGhost}>
                <OverlaySkeleton
                  width={stageSize.width}
                  height={stageSize.height}
                  frame={currentFrame}
                />
              </View>
            ) : null}

            {playbackFrames.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text style={styles.emptyTitle}>Source captured.</Text>
                <Text style={styles.emptyText}>
                  This take has video metadata but no readable local motion frames yet.
                </Text>
                <View style={styles.emptyActions}>
                  {canProcess ? (
                    <Button
                      label={showProcessingHint ? "Start processing" : "Process source"}
                      size="sm"
                      onPress={openExportFlow}
                    />
                  ) : null}
                  <Button label="Open review" variant="secondary" size="sm" onPress={openReview} />
                </View>
              </View>
            ) : null}
          </View>

          <View style={[styles.timelineDock, { bottom: insets.bottom + 124 }]}>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatFrameTime(playhead, fps)}</Text>
              <Text style={styles.timeText}>
                {playbackFrames.length ? `${playhead + 1}/${playbackFrames.length}` : "0/0"}
              </Text>
            </View>
            <Pressable
              onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)}
              onPress={(event) => handleTimelinePress(event.nativeEvent.locationX)}
              style={styles.timeline}
            >
              <View style={styles.timelineTrack} />
              <View style={[styles.timelineFill, { width: `${progress * 100}%` }]} />
              <View style={[styles.timelineKnob, { left: `${progress * 100}%` }]} />
            </Pressable>
          </View>
        </View>
      ) : (
        <ScrollView
          style={styles.gallery}
          contentContainerStyle={[
            styles.galleryContent,
            { paddingTop: insets.top + 92, paddingBottom: insets.bottom + 132 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.galleryGrid}>
            {galleryItems.map((item) => (
              <GalleryTile
                key={item.take.id}
                item={item}
                frame={thumbnailFrames[item.take.id]}
                active={item.take.id === selectedTakeId}
                onPress={() => selectGalleryTake(item.take.id)}
              />
            ))}
          </View>
          {galleryLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.gallerySpinner} />
          ) : null}
        </ScrollView>
      )}

      <View style={[styles.topChrome, { top: insets.top + spacing.sm }]}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <View style={styles.chevronA} />
          <View style={styles.chevronB} />
        </Pressable>

        <View style={styles.topCenter}>
          {mode === "player" ? (
            <View style={styles.segmentedPill}>
              <View style={[styles.segmentButton, side === "front" && styles.segmentButtonActive]}>
                <Text style={styles.segmentText}>front</Text>
              </View>
              <View style={styles.segmentDot} />
              <View style={[styles.segmentButton, side === "back" && styles.segmentButtonActive]}>
                <Text style={styles.segmentText}>back</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.galleryTitle}>Gallery</Text>
          )}
          {take ? <Text style={styles.takeTitle} numberOfLines={1}>{take.name}</Text> : null}
        </View>

        <Pressable style={styles.profileButton} onPress={openReview}>
          <View style={styles.profileHead} />
          <View style={styles.profileBody} />
        </Pressable>
      </View>

      <View style={[styles.bottomControls, { bottom: insets.bottom + spacing.md }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open gallery"
          style={[styles.menuButton, mode === "gallery" && styles.controlActive]}
          onPress={() => setMode((value) => (value === "player" ? "gallery" : "player"))}
        >
          <View style={styles.menuGrid}>
            <View style={styles.menuSquareWide} />
            <View style={styles.menuSquare} />
            <View style={styles.menuSquare} />
            <View style={styles.menuSquareWide} />
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause animation" : "Play animation"}
          disabled={playbackFrames.length <= 1}
          style={[
            styles.shutterButton,
            playbackFrames.length <= 1 && styles.controlDisabled,
          ]}
          onPress={() => setPlaying((value) => !value)}
        >
          {playing ? (
            <View style={styles.pauseIcon}>
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playIcon} />
          )}
        </Pressable>

        <Pressable style={styles.statusOrb} onPress={openExportFlow}>
          <View style={styles.statusOrbRow}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: playbackFrames.length > 0 ? colors.accent : colors.warning },
              ]}
            />
            <Text style={styles.statusOrbTime}>
              {take ? formatDuration(take.durationMs || take.video?.durationMs || 0) : "0s"}
            </Text>
          </View>
          <Text style={styles.statusOrbLabel}>
            {take?.remote?.status === "completed"
              ? "result"
              : showProcessingHint
                ? "process"
                : takeBadge(take ?? ({} as Take))}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function GalleryTile({
  item,
  frame,
  active,
  onPress,
}: {
  item: GalleryItem;
  frame?: PoseFrame;
  active: boolean;
  onPress: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.galleryTile,
        active && styles.galleryTileActive,
        pressed && styles.galleryTilePressed,
      ]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      <View style={styles.galleryTilePreview}>
        {frame && size.width > 0 && size.height > 0 ? (
          <OverlaySkeleton width={size.width} height={size.height - 40} frame={frame} />
        ) : (
          <View style={styles.galleryTileEmpty}>
            <View style={styles.galleryTileEmptyHead} />
            <View style={styles.galleryTileEmptyBody} />
          </View>
        )}
      </View>
      <View style={styles.galleryTileFooter}>
        <Text style={styles.galleryTileTitle} numberOfLines={1}>
          {item.take.name}
        </Text>
        <Text style={styles.galleryTileSubtitle} numberOfLines={1}>
          {item.subtitle}
        </Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{item.badge}</Text>
      </View>
      {active ? (
        <View style={styles.checkBadge}>
          <View style={styles.checkShort} />
          <View style={styles.checkLong} />
        </View>
      ) : null}
    </Pressable>
  );
}

const GLASS_BLACK = "rgba(0, 0, 0, 0.82)";
const GLASS_BORDER = "rgba(255, 255, 255, 0.16)";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.black,
  },
  loadingText: {
    ...typography.body.md,
    marginTop: spacing.md,
    color: "rgba(255,255,255,0.72)",
  },
  player: {
    ...StyleSheet.absoluteFillObject,
  },
  stage: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: colors.black,
  },
  stageBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#030508",
  },
  backdropLineA: {
    position: "absolute",
    left: -60,
    right: -60,
    top: "32%",
    height: 1,
    transform: [{ rotate: "-10deg" }],
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  backdropLineB: {
    position: "absolute",
    left: -70,
    right: -70,
    top: "52%",
    height: 1,
    transform: [{ rotate: "9deg" }],
    backgroundColor: "rgba(108,242,214,0.16)",
  },
  backdropFloor: {
    position: "absolute",
    left: -80,
    right: -80,
    bottom: -40,
    height: "35%",
    transform: [{ rotate: "-4deg" }],
    backgroundColor: "rgba(255,255,255,0.035)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  backdropGlow: {
    position: "absolute",
    left: "16%",
    right: "16%",
    bottom: "18%",
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(108,242,214,0.08)",
    transform: [{ scaleX: 1.8 }],
  },
  skeletonGhost: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.18,
  },
  emptyPanel: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    top: "34%",
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.84)",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.title.card,
    color: colors.white,
  },
  emptyText: {
    ...typography.body.md,
    color: "rgba(255,255,255,0.68)",
  },
  emptyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  gallery: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black,
  },
  galleryContent: {
    paddingHorizontal: spacing.md,
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  gallerySpinner: {
    marginTop: spacing.lg,
  },
  galleryTile: {
    flexBasis: "31.8%",
    flexGrow: 1,
    maxWidth: "32.4%",
    aspectRatio: 0.64,
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "rgba(66,66,66,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  galleryTileActive: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  galleryTilePressed: {
    transform: [{ scale: 0.985 }],
  },
  galleryTilePreview: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  galleryTileEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryTileEmptyHead: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    opacity: 0.8,
  },
  galleryTileEmptyBody: {
    width: 54,
    height: 70,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: colors.accent,
    opacity: 0.7,
  },
  galleryTileFooter: {
    height: 42,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.74)",
  },
  galleryTileTitle: {
    ...typography.label.sm,
    color: colors.white,
    letterSpacing: 0,
  },
  galleryTileSubtitle: {
    ...typography.body.sm,
    color: "rgba(255,255,255,0.52)",
    fontSize: 10,
    lineHeight: 13,
  },
  badge: {
    position: "absolute",
    left: 6,
    bottom: 48,
    minHeight: 22,
    justifyContent: "center",
    paddingHorizontal: 7,
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  badgeText: {
    ...typography.label.sm,
    color: colors.white,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0,
  },
  checkBadge: {
    position: "absolute",
    right: 8,
    bottom: 50,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: colors.accent,
  },
  checkShort: {
    position: "absolute",
    width: 7,
    height: 3,
    left: 7,
    top: 14,
    borderRadius: 2,
    transform: [{ rotate: "45deg" }],
    backgroundColor: colors.accent,
  },
  checkLong: {
    position: "absolute",
    width: 14,
    height: 3,
    left: 11,
    top: 12,
    borderRadius: 2,
    transform: [{ rotate: "-45deg" }],
    backgroundColor: colors.accent,
  },
  topChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 30,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  chevronA: {
    position: "absolute",
    width: 20,
    height: 5,
    borderRadius: 4,
    transform: [{ rotate: "-45deg" }, { translateY: -5 }],
    backgroundColor: colors.white,
  },
  chevronB: {
    position: "absolute",
    width: 20,
    height: 5,
    borderRadius: 4,
    transform: [{ rotate: "45deg" }, { translateY: 5 }],
    backgroundColor: colors.white,
  },
  topCenter: {
    maxWidth: "62%",
    alignItems: "center",
    gap: spacing.xs,
  },
  segmentedPill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: GLASS_BLACK,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  segmentButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 9,
    borderRadius: 9,
  },
  segmentButtonActive: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  segmentText: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 21,
    lineHeight: 25,
  },
  segmentDot: {
    width: 4,
    height: 4,
    marginHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  galleryTitle: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 24,
    lineHeight: 28,
  },
  takeTitle: {
    ...typography.label.sm,
    maxWidth: 220,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    overflow: "hidden",
    borderRadius: radii.pill,
    color: "rgba(255,255,255,0.72)",
    backgroundColor: "rgba(0,0,0,0.44)",
    letterSpacing: 0,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: GLASS_BLACK,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  profileHead: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.white,
    marginBottom: 3,
  },
  profileBody: {
    width: 22,
    height: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: colors.white,
  },
  timelineDock: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 24,
    gap: spacing.xs,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeText: {
    ...typography.mono.sm,
    color: "rgba(255,255,255,0.7)",
  },
  timeline: {
    height: 28,
    justifyContent: "center",
  },
  timelineTrack: {
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  timelineFill: {
    position: "absolute",
    left: 0,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
  },
  timelineKnob: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.5)",
  },
  bottomControls: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuButton: {
    width: 74,
    height: 74,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 37,
  },
  controlActive: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  controlDisabled: {
    opacity: 0.45,
  },
  menuGrid: {
    width: 52,
    height: 52,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
    gap: 5,
  },
  menuSquareWide: {
    width: 26,
    height: 19,
    borderRadius: 4,
    backgroundColor: colors.white,
  },
  menuSquare: {
    width: 19,
    height: 26,
    borderRadius: 4,
    backgroundColor: colors.white,
  },
  shutterButton: {
    width: 98,
    height: 98,
    borderRadius: 49,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 8,
    borderColor: colors.white,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  playIcon: {
    width: 0,
    height: 0,
    marginLeft: 6,
    borderTopWidth: 19,
    borderBottomWidth: 19,
    borderLeftWidth: 29,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.white,
  },
  pauseIcon: {
    width: 42,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pauseBar: {
    width: 11,
    height: 36,
    borderRadius: 4,
    backgroundColor: colors.white,
  },
  statusOrb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusOrbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  statusOrbTime: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 20,
    lineHeight: 23,
  },
  statusOrbLabel: {
    ...typography.label.sm,
    maxWidth: 74,
    color: "rgba(255,255,255,0.48)",
    marginTop: 3,
    letterSpacing: 0,
  },
});
