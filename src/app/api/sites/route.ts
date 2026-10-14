import { z } from "zod";
import { createSite, listSites } from "@/lib/model";
import { fail, handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({ sites: listSites() });
  } catch (err) {
    return handle(err);
  }
}

const Body = z.object({ name: z.string().trim().min(1).max(120), location: z.string().trim().max(120).nullish() });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("A site name is required.");
    const id = createSite(parsed.data.name, parsed.data.location || null);
    return ok({ id }, 201);
  } catch (err) {
    return handle(err);
  }
}
