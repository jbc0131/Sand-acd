// npm run seed: (re)creates the fictional sample site in ./data/cda.db. No API key needed.
import { raw } from "../src/lib/db";
import { seedSampleSite } from "../src/lib/sample/seed";
import { SAMPLE_SITE_NAME } from "../src/lib/sample/data";
import { removeUpload } from "../src/lib/model";

const db = raw();
const old = db.prepare(`SELECT id FROM sites WHERE name = ?`).all(SAMPLE_SITE_NAME) as { id: number }[];
for (const s of old) {
  const files = db.prepare(`SELECT file_path FROM sources WHERE site_id = ?`).all(s.id) as { file_path: string }[];
  db.prepare(`DELETE FROM sites WHERE id = ?`).run(s.id);
  files.forEach((f) => removeUpload(f.file_path));
}
const id = seedSampleSite();
console.log(`Seeded "${SAMPLE_SITE_NAME}" as site ${id}${old.length ? ` (replaced ${old.length} older copy)` : ""}.`);
