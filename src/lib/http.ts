import "server-only";
import { UserFacingError, toUserMessage } from "./ai";

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Maps any thrown error to a short JSON error. Never leaks stack traces. */
export function handle(err: unknown) {
  if (err instanceof UserFacingError) return fail(err.message, 400);
  console.error(err);
  return fail(toUserMessage(err), 500);
}

export function parseId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
