import { useCallback, useState } from "react";
import type { TakeId } from "../../../domain/mocap/models/Take";
import { TakeExporter, type ExportFormat } from "../../../domain/mocap/pipeline/export/TakeExporter";

export function useExportTake() {
  const [exporting, setExporting] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  const runExport = useCallback(async (takeId: TakeId, format: ExportFormat = "both") => {
    setExporting(true);
    setLastError(undefined);
    try {
      const out = await TakeExporter.exportTake(takeId, { format });
      const path = out.bvhPath ?? out.jsonPath;
      if (path) await TakeExporter.shareFile(path);
      return out;
    } catch (e: any) {
      setLastError(e?.message ?? "Export failed");
      throw e;
    } finally {
      setExporting(false);
    }
  }, []);

  return { exporting, lastError, runExport };
}
