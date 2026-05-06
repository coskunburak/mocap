import {
  HttpMocapApiClient,
  type MocapApiClient,
} from "../../infra/api/MocapApiClient";
import {
  ApiMocapSessionService,
  type MocapSessionService,
} from "../../domain/mocap/services/MocapSessionService";
import {
  ApiExportService,
  type ExportService,
} from "../../domain/mocap/services/ExportService";
import {
  SignedUrlUploadManager,
} from "../../features/upload/data/SignedUrlUploadManager";
import type { UploadManager } from "../../features/upload/domain/UploadManager";
import { env } from "../config/env";

const apiClient: MocapApiClient = new HttpMocapApiClient({
  baseUrl: env.apiBaseUrl,
  timeoutMs: env.apiTimeoutMs,
  tokenProvider: () => env.devToken,
});

export const container: Readonly<{
  apiClient: MocapApiClient;
  mocapSessionService: MocapSessionService;
  exportService: ExportService;
  uploadManager: UploadManager;
}> = {
  apiClient,
  mocapSessionService: new ApiMocapSessionService(apiClient),
  exportService: new ApiExportService(apiClient),
  uploadManager: new SignedUrlUploadManager({
    api: apiClient,
    sessions: new ApiMocapSessionService(apiClient),
  }),
};
