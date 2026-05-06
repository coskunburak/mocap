import type {
  ApiExportFile,
  MocapApiClient,
} from "../../../infra/api/MocapApiClient";

export interface ExportService {
  listExports(takeId: string): Promise<readonly ApiExportFile[]>;
  getDownloadUrl(exportId: string): Promise<{ downloadUrl: string; expiresAt: string }>;
}

export class ApiExportService implements ExportService {
  constructor(private readonly api: MocapApiClient) {}

  listExports(takeId: string) {
    return this.api.listExports(takeId);
  }

  getDownloadUrl(exportId: string) {
    return this.api.getExportDownloadUrl(exportId);
  }
}
