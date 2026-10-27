const SPELLBOOK_URL = "https://backend.commanderspellbook.com/find-my-combos/";

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const upstream = await fetch(SPELLBOOK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spellbook request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
