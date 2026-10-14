import { seedSampleSite } from "@/lib/sample/seed";
import { handle, ok } from "@/lib/http";

export async function POST() {
  try {
    return ok({ id: await seedSampleSite() }, 201);
  } catch (err) {
    return handle(err);
  }
}
