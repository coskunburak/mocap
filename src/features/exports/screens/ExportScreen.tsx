import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";

import type { TakeId } from "../../../domain/mocap/models/Take";
import { TakeExporter } from "../../../domain/mocap/pipeline/export/TakeExporter";
import {
  getExportPreset,
  listExportPresets,
  type ExportFormat,
  type ExportPresetId,
} from "../../../domain/mocap/pipeline/export/ExportPresets";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import { routes } from "../../../app/navigation/routes";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { Screen, ScreenHeader } from "../../../ui/components/Screen";
import { colors, radii, spacing, typography } from "../../../ui/theme";

type RouteParams = {
  takeId?: string;
  autoExport?: boolean;
  format?: ExportFormat;
  presetId?: ExportPresetId;
};

type Nav = any;

type OutputFile = {
  format: string;
  path: string;
  primary?: boolean;
};

const FORMAT_OPTIONS: ExportFormat[] = [
  "bundle",
  "fbx",
  "glb",
  "gltf",
  "usd",
  "bvh",
  "json",
];

export default function ExportScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const params: RouteParams | undefined = route?.params;

  const [takeId, setTakeId] = useState<string>(params?.takeId ?? "");
  const [format, setFormat] = useState<ExportFormat>(params?.format ?? "bundle");
  const [presetId, setPresetId] = useState<ExportPresetId>(
    params?.presetId ?? "dcc-archive",
  );
  const [busy, setBusy] = useState(false);
  const [recentTakes, setRecentTakes] = useState<
    Array<{ id: string; name: string; createdAt: number }>
  >([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [exportDir, setExportDir] = useState<string | undefined>();

  const presets = useMemo(() => listExportPresets(), []);
  const selectedPreset = useMemo(() => getExportPreset(presetId), [presetId]);

  useEffect(() => {
    if (params?.takeId && params.takeId !== takeId) setTakeId(params.takeId);
    if (params?.format) setFormat(params.format);
    if (params?.presetId) setPresetId(params.presetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.takeId, params?.format, params?.presetId]);

  const canExport = useMemo(
    () => takeId.trim().length > 0 && !busy,
    [takeId, busy],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const list = await takeRepoFs.listTakes();
        if (!active) return;
        setRecentTakes(
          list.slice(0, 6).map((take) => ({
            id: take.id,
            name: take.name,
            createdAt: take.createdAt,
          })),
        );
      })();

      return () => {
        active = false;
      };
    }, []),
  );

  const doExport = useCallback(
    async (id: TakeId, fmt: ExportFormat, preset: ExportPresetId) => {
      setBusy(true);
      setOutputs([]);
      setExportDir(undefined);

      try {
        await TakeExporter.getTakeMeta(id);

        const res = await TakeExporter.exportTake(id, {
          format: fmt,
          presetId: preset,
          filenamePrefix: `take_${id}`,
          includeFramesInJson: true,
        });

        setOutputs(res.files);
        setExportDir(res.exportDir);

        const warningCount =
          res.validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0;
        Alert.alert(
          "Export hazır",
          warningCount > 0
            ? `Dosyalar oluşturuldu. ${warningCount} validation warning var.`
            : "Dosyalar oluşturuldu.",
        );
      } catch (e: any) {
        console.error("[ExportScreen] export error", e);
        Alert.alert("Export hata", e?.message ?? "Export failed");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onExport = useCallback(async () => {
    const id = takeId.trim() as TakeId;
    if (!id) return;
    await doExport(id, format, presetId);
  }, [doExport, format, presetId, takeId]);

  useEffect(() => {
    if (!params?.autoExport) return;

    const id = (params?.takeId ?? "").trim() as TakeId;
    if (!id || busy) return;

    void doExport(id, params?.format ?? format, params?.presetId ?? presetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.autoExport, params?.takeId]);

  const onShare = useCallback(async (path?: string) => {
    if (!path) return;
    try {
      const res = await TakeExporter.shareFile(path);
      if (!res.shared) {
        Alert.alert("Paylaşım yok", "Bu cihazda paylaşım desteklenmiyor.");
      }
    } catch (e: any) {
      Alert.alert("Share hata", e?.message ?? "Share failed");
    }
  }, []);

  return (
    <Screen
      scroll
      background={outputs.length ? "accent" : "default"}
      contentContainerStyle={styles.container}
    >
      <ScreenHeader
        eyebrow="Asset Builder"
        title="Compose production handoff packages."
        subtitle="Generate FBX, GLB, glTF, USD, BVH, or JSON from a reviewed take, with delivery presets for Unity, Unreal, web preview, and DCC archive workflows."
        right={
          <View style={styles.headerActions}>
            {takeId.trim().length ? (
              <Button
                label="Review"
                variant="secondary"
                size="sm"
                onPress={() =>
                  navigation.navigate(routes.Review, { takeId: takeId.trim() })
                }
              />
            ) : null}
            <Button
              label="Back"
              variant="ghost"
              size="sm"
              onPress={() => navigation.goBack()}
            />
          </View>
        }
      />

      <Card tone="accent" style={styles.card}>
        <Text style={styles.label}>Take ID</Text>
        <TextInput
          value={takeId}
          onChangeText={setTakeId}
          placeholder="1735970000-ab12cd"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Text style={styles.label}>Format</Text>
        <View style={styles.row}>
          {FORMAT_OPTIONS.map((option) => (
            <FormatButton
              key={option}
              label={option.toUpperCase()}
              active={format === option}
              onPress={() => setFormat(option)}
            />
          ))}
        </View>

        <Text style={styles.label}>Preset</Text>
        <View style={styles.presetGrid}>
          {presets.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => setPresetId(preset.id)}
              style={({ pressed }) => [
                styles.presetCard,
                presetId === preset.id ? styles.presetCardActive : null,
                pressed ? styles.recentItemPressed : null,
              ]}
            >
              <Text style={styles.presetLabel}>{preset.label}</Text>
              <Text style={styles.presetDescription}>{preset.description}</Text>
              <Text style={styles.presetMeta}>
                {preset.formats.join(" + ").toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.presetHint}>
          Primary {selectedPreset.primaryFormat.toUpperCase()}  •  Retarget{" "}
          {selectedPreset.retargetPresetId}
        </Text>

        <Button
          label={busy ? "Exporting..." : "Run export"}
          fullWidth
          loading={busy}
          disabled={!canExport}
          onPress={onExport}
        />
      </Card>

      <Card tone="default" style={styles.card}>
        <Text style={styles.label}>Recent takes</Text>
        <View style={styles.recentGrid}>
          {recentTakes.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setTakeId(item.id)}
              style={({ pressed }) => [
                styles.recentItem,
                pressed ? styles.recentItemPressed : null,
              ]}
            >
              <Text style={styles.recentName}>{item.name}</Text>
              <Text style={styles.recentMeta}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
              <Text style={styles.recentId} numberOfLines={1}>
                {item.id}
              </Text>
            </Pressable>
          ))}
          {recentTakes.length === 0 ? (
            <Text style={styles.muted}>
              No recent takes found. Record a session first.
            </Text>
          ) : null}
        </View>
      </Card>

      <Card tone={outputs.length ? "accent" : "muted"} style={styles.card}>
        <Text style={styles.label}>Output</Text>

        {!!exportDir && (
          <Text style={styles.path}>Export directory: {exportDir}</Text>
        )}

        {outputs.map((file) => (
          <OutputRow
            key={file.path}
            label={
              file.primary
                ? `${file.format.toUpperCase()} • PRIMARY`
                : file.format.toUpperCase()
            }
            path={file.path}
            onShare={() => onShare(file.path)}
          />
        ))}

        {!outputs.length ? (
          <Text style={styles.muted}>
            No files generated yet. Export a take to populate this panel.
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

function FormatButton({
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
      style={({ pressed }) => [
        styles.pill,
        active ? styles.pillActive : null,
        pressed ? styles.pillPressed : null,
      ]}
    >
      <Text style={[styles.pillText, active ? styles.pillTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function OutputRow({
  label,
  path,
  onShare,
}: {
  label: string;
  path: string;
  onShare: () => void;
}) {
  return (
    <View style={styles.outputRow}>
      <View style={styles.outputCopy}>
        <Text style={styles.outputLabel}>{label}</Text>
        <Text style={styles.path}>{path}</Text>
      </View>
      <Button label="Share" variant="secondary" size="sm" onPress={onShare} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 48,
    gap: spacing.md,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  card: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label.md,
  },
  input: {
    minHeight: 54,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
    color: colors.textPrimary,
    ...typography.body.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  presetGrid: {
    gap: spacing.sm,
  },
  presetCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(9, 20, 35, 0.72)",
    gap: spacing.xs,
  },
  presetCardActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  presetLabel: {
    ...typography.label.md,
  },
  presetDescription: {
    ...typography.body.sm,
    color: colors.textSecondary,
  },
  presetMeta: {
    ...typography.label.sm,
    color: colors.accent,
  },
  presetHint: {
    ...typography.body.sm,
    color: colors.textMuted,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(9, 20, 35, 0.72)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  pillPressed: {
    transform: [{ scale: 0.98 }],
  },
  pillText: {
    ...typography.label.md,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.textPrimary,
  },
  recentGrid: {
    gap: spacing.sm,
  },
  recentItem: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xxs,
    backgroundColor: "rgba(9, 20, 35, 0.72)",
    borderWidth: 1,
    borderColor: colors.line,
  },
  recentItemPressed: {
    transform: [{ scale: 0.99 }],
  },
  recentName: {
    ...typography.label.md,
  },
  recentMeta: {
    ...typography.body.sm,
  },
  recentId: {
    ...typography.mono.sm,
  },
  outputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  outputCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  outputLabel: {
    ...typography.label.sm,
    color: colors.textPrimary,
  },
  path: {
    ...typography.body.sm,
    color: colors.textSecondary,
  },
  muted: {
    ...typography.body.sm,
    color: colors.textMuted,
  },
});
