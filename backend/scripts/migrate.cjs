require("dotenv/config");

const fs = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
