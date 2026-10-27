import { ensureForgeEngine } from "@/lib/reforge-process";

export async function POST() {
  try {
    const port = await ensureForgeEngine();
    return Response.json({ port });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The play engine did not start";
    return Response.json({ error: message }, { status: 500 });
  }
}
