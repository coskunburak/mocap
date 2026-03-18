import { useCallback, useState } from "react";
import type { TakeId } from "../../../domain/mocap/models/Take";
import { TakeExporter } from "../../../domain/mocap/pipeline/export/TakeExporter";
import type {
  ExportFormat,
  ExportPresetId,
} from "../../../domain/mocap/pipeline/export/ExportPresets";

export function useExportTake() {
  const [exporting, setExporting] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  const runExport = useCallback(
    async (
      takeId: TakeId,
      format: ExportFormat = "bundle",
      presetId?: ExportPresetId,
    ) => {
      setExporting(true);
      setLastError(undefined);
      try {
        const out = await TakeExporter.exportTake(takeId, { format, presetId });
        const path = out.primaryPath ?? out.files[0]?.path;
        if (path) await TakeExporter.shareFile(path);
        return out;
      } catch (e: any) {
        setLastError(e?.message ?? "Export failed");
        throw e;
      } finally {
        setExporting(false);
      }
    },
    [],
  );

  return { exporting, lastError, runExport };
}
