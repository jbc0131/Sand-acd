import { seedSampleSite } from "@/lib/sample/seed";
import { handle, ok } from "@/lib/http";

export async function POST() {
  try {
    return ok({ id: seedSampleSite() }, 201);
  } catch (err) {
    return handle(err);
  }
}
