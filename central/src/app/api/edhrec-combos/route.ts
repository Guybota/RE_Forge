import { NextRequest } from "next/server";
import { edhrecCommanderSlug, parseEdhrecComboPage } from "@/lib/edhrec-combos";

export async function GET(request: NextRequest) {
  const names = request.nextUrl.searchParams
    .getAll("commander")
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 0) {
    return Response.json({ ok: false, error: "Missing commander." }, { status: 400 });
  }

  const commanders = [];
  const failures: string[] = [];

  for (const name of names) {
    const slug = edhrecCommanderSlug(name);
    const url = `https://json.edhrec.com/pages/combos/${slug}.json`;
    try {
      const upstream = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MTG-Central/1.0",
        },
        cache: "no-store",
      });
      if (!upstream.ok) {
        failures.push(name);
        continue;
      }
      const json: unknown = await upstream.json();
      commanders.push(parseEdhrecComboPage(name, json));
    } catch {
      failures.push(name);
    }
  }

  if (commanders.length === 0) {
    return Response.json(
      {
        ok: false,
        error: `EDHREC has no combo tab for ${failures.join(", ")}.`,
      },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, commanders });
}
