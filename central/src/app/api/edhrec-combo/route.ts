import { NextRequest } from "next/server";
import { edhrecComboPath, parseEdhrecComboDetail } from "@/lib/edhrec-combos";

export async function GET(request: NextRequest) {
  const path = edhrecComboPath(request.nextUrl.searchParams.get("path") ?? "");
  if (!path) {
    return Response.json({ ok: false, error: "Missing combo." }, { status: 400 });
  }

  try {
    const upstream = await fetch(`https://json.edhrec.com/pages${path}.json`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MTG-Central/1.0",
      },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return Response.json(
        { ok: false, error: `EDHREC returned HTTP ${upstream.status}. Try again later.` },
        { status: 502 },
      );
    }
    const json: unknown = await upstream.json();
    const detail = parseEdhrecComboDetail(json);
    if (!detail) {
      return Response.json(
        { ok: false, error: "EDHREC did not include an explanation for this combo." },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, ...detail });
  } catch {
    return Response.json({ ok: false, error: "Could not reach EDHREC." }, { status: 502 });
  }
}
