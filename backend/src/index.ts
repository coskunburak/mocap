import { config } from "./config";
import { closeDb } from "./infra/db/postgres";
import { buildServer } from "./server";

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });

  const shutdown = async () => {
    await app.close();
    await closeDb();
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

