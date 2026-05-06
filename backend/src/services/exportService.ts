import { ExportRepository } from "../infra/db/repositories";
import { ObjectStorage } from "../infra/storage/objectStorage";

export class ExportService {
  constructor(
    private readonly exports = new ExportRepository(),
    private readonly storage = new ObjectStorage(),
  ) {}

  async listByTake(userId: string, takeId: string) {
    return this.exports.listByTake(userId, takeId);
  }

  async downloadUrl(userId: string, exportId: string) {
    const exportFile = await this.exports.get(userId, exportId);
    return this.storage.signedDownloadUrl(exportFile.storageKey);
  }
}

