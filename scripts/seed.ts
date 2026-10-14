// npm run seed: (re)creates the fictional sample site in ./data/cda.db. No API key needed.
import fs from "node:fs";
import path from "node:path";
import { raw, UPLOAD_DIR } from "../src/lib/db";
import { seedSampleSite } from "../src/lib/sample/seed";
import { SAMPLE_SITE_NAME } from "../src/lib/sample/data";

void (async () => {
  const db = raw();
  const old = db.prepare(`SELECT id FROM sites WHERE name = ?`).all(SAMPLE_SITE_NAME) as { id: number }[];
  for (const s of old) {
    db.prepare(`DELETE FROM sites WHERE id = ?`).run(s.id);
    fs.rmSync(path.join(UPLOAD_DIR, String(s.id)), { recursive: true, force: true });
  }
  const id = await seedSampleSite();
  console.log(`Seeded "${SAMPLE_SITE_NAME}" as site ${id}${old.length ? ` (replaced ${old.length} older copy)` : ""}.`);
})();
