
import { db } from "./src/lib/db/index";
import { clients } from "./src/lib/db/schema";
import { listFilesInFolder } from "./src/lib/gdrive";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const allClients = await db.select().from(clients);
  console.log(`Backfilling folder_path for ${allClients.length} clients...`);

  let updated = 0, errors = 0;

  for (const client of allClients) {
    if (!client.driveFolderId) continue;
    try {
      process.stdout.write(`[${client.name}] Scanning Drive... `);
      const files = await listFilesInFolder(client.driveFolderId);
      console.log(`${files.length} files`);
      
      // Update each clip by drive_file_id using raw SQL
      for (const f of files) {
        if (f.folderPath === undefined) continue;
        const r = await pool.query(
          "UPDATE clips SET folder_path = $1 WHERE drive_file_id = $2 AND folder_path IS NULL",
          [f.folderPath, f.id]
        );
        updated += r.rowCount || 0;
      }
      console.log(`  -> ${updated} total updated so far`);
    } catch(e) {
      console.error(`[${client.name}] Error:`, (e as Error).message);
      errors++;
    }
  }

  console.log(`Done: ${updated} clips updated, ${errors} errors`);
  await pool.end();
  process.exit(0);
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
