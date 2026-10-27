#!/usr/bin/env python3
"""Build src/data/card-tags.json from Scryfall type lines and oracle text.

Bit names are read from src/lib/card-tag-bits.ts so the two stay aligned.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BITS = ROOT / "src/lib/card-tag-bits.ts"
PRECONS = ROOT / "src/data/precons.json"
SEED = ROOT / "src/lib/seed-decks.ts"
ADAPT = ROOT / "src/lib/improve-adapt.ts"
OUT = ROOT / "src/data/card-tags.json"
CACHE = Path("/tmp/mtg-central-scryfall-cache.json")

SKIP_SUBS = {
    "Aura",
    "Equipment",
    "Vehicle",
    "Saga",
    "Clue",
    "Food",
    "Treasure",
    "Blood",
    "Gold",
    "Powerstone",
    "Shard",
    "Class",
    "Background",
    "Lesson",
    "Case",
    "Room",
    "Attraction",
    "Contraption",
}


def load_bits() -> dict[str, int]:
    bits: dict[str, int] = {}
    for name, shift in re.findall(r"export const (TYPE_\w+|THEME_\w+) = 1 << (\d+);", BITS.read_text()):
        bits[name] = 1 << int(shift)
    return bits


def collect_names() -> tuple[set[str], set[str]]:
    names: set[str] = set()
    data = json.loads(PRECONS.read_text())
    for deck in data:
        for card in deck["commanders"] + deck["cards"]:
            names.add(card["name"])
    for line in SEED.read_text().splitlines():
        match = re.match(r'\s*"([^"]+)",\s*$', line)
        if match:
            names.add(match.group(1))
    offers: set[str] = set()
    adapt = ADAPT.read_text()
    for match in re.finditer(r'\bo\(\s*"([^"]+)"', adapt):
        offers.add(match.group(1))
        names.add(match.group(1))
    return names, offers


def fetch_cards(names: list[str]) -> dict[str, dict]:
    cache: dict[str, dict] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text())
    missing = [name for name in names if name not in cache]
    print(f"cache {len(cache)} missing {len(missing)}", flush=True)

    def post(batch: list[str]) -> dict:
        body = json.dumps({"identifiers": [{"name": name} for name in batch]}).encode()
        req = urllib.request.Request(
            "https://api.scryfall.com/cards/collection",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "mtg-central-pwa/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.load(res)

    for index in range(0, len(missing), 75):
        batch = missing[index : index + 75]
        payload = None
        for attempt in range(4):
            try:
                payload = post(batch)
                break
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")[:300]
                print(f"http {err.code} {detail}", flush=True)
                if err.code == 429 or err.code >= 500:
                    time.sleep(2 + attempt)
                    continue
                raise
        if payload is None:
            raise SystemExit("scryfall collection failed")
        for card in payload.get("data", []):
            cache[card["name"]] = card
            for face in card.get("card_faces") or []:
                face_name = face.get("name")
                if face_name and face_name not in cache:
                    cache[face_name] = card
        for ident in payload.get("not_found", []):
            missing_name = ident.get("name")
            if missing_name:
                cache[missing_name] = {"missing": True, "name": missing_name}
        CACHE.write_text(json.dumps(cache))
        print(f"fetched {min(index + 75, len(missing))}/{len(missing)}", flush=True)
        time.sleep(0.12)
    return cache


def parse_type(type_line: str, bits: dict[str, int]) -> tuple[int, list[str]]:
    cleaned = type_line.replace("—", "-").replace("–", "-")
    left, _, right = cleaned.partition("-")
    mask = 0
    type_map = {
        "Creature": bits["TYPE_CREATURE"],
        "Instant": bits["TYPE_INSTANT"],
        "Sorcery": bits["TYPE_SORCERY"],
        "Enchantment": bits["TYPE_ENCHANTMENT"],
        "Artifact": bits["TYPE_ARTIFACT"],
        "Land": bits["TYPE_LAND"],
        "Planeswalker": bits["TYPE_PLANESWALKER"],
        "Battle": bits["TYPE_BATTLE"],
        "Legendary": bits["TYPE_LEGENDARY"],
    }
    words = left.split()
    for word in words:
        mask |= type_map.get(word, 0)
    subs: list[str] = []
    creature = "Creature" in words
    for sub in right.split():
        if sub == "Aura":
            mask |= bits["TYPE_AURA"]
        elif sub == "Equipment":
            mask |= bits["TYPE_EQUIPMENT"]
        elif sub == "Vehicle":
            mask |= bits["TYPE_VEHICLE"]
        elif sub == "Saga":
            mask |= bits["TYPE_SAGA"]
        elif creature and sub not in SKIP_SUBS:
            subs.append(sub)
    return mask, subs


def clean_oracle(text: str) -> str:
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def theme_mask(oracle: str, keywords: list[str], bits: dict[str, int]) -> int:
    mask = 0
    keys = {word.lower() for word in keywords}
    text = oracle

    def add(bit: int, cond: bool) -> None:
        nonlocal mask
        if cond:
            mask |= bit

    add(bits["THEME_LIFE"], "lifelink" in keys or bool(re.search(r"you gain (\d+|x|that much|twice that) life|whenever you gain life", text)))
    add(bits["THEME_TOKEN"], bool(re.search(r"create .{0,140}(\d/\d|creature token|token that's a copy|token that is a copy)", text)))
    add(bits["THEME_TREASURE"], bool(re.search(r"\btreasure\b", text)))
    add(bits["THEME_SAC"], bool(re.search(r"sacrifice (a|an|another|one|two|three|x)\b", text)))
    add(bits["THEME_COUNTER"], "+1/+1 counter" in text)
    add(bits["THEME_SPELL"], "instant or sorcery" in text or "noncreature spell" in text)
    add(bits["THEME_YARD"], bool(re.search(r"from (your|a|their) graveyard|in your graveyard|graveyard to (your hand|the battlefield)", text)))
    add(bits["THEME_MILL"], "mill" in keys or bool(re.search(r"\bmill", text)))
    add(bits["THEME_LAND"], "landfall" in keys or "whenever a land enters" in text)
    add(bits["THEME_BLINK"], bool(re.search(r"exile .{0,80}return (that|it|those|the exiled)", text)))
    add(bits["THEME_DRAW"], bool(re.search(r"whenever you draw|whenever an opponent draws|each player draws|draws an additional", text)))
    add(bits["THEME_GOAD"], "goad" in keys or bool(re.search(r"\bgoad", text)))
    add(bits["THEME_MONARCH"], "the monarch" in text)
    add(bits["THEME_WHEEL"], bool(re.search(r"discards (their|his or her) hand|each player discards", text)))
    add(bits["THEME_DONATE"], bool(re.search(r"give control|opponent gains control|player gains control of target permanent you", text)))
    add(bits["THEME_DEATH"], bool(re.search(r"whenever (another |a )?creature (you control )?dies|whenever a creature dies", text)))
    add(bits["THEME_POISON"], "poison" in text or "infect" in keys or "toxic" in keys)
    add(bits["THEME_ENERGY"], "{e}" in text or "energy counter" in text)
    add(bits["THEME_FOOD"], bool(re.search(r"\bfood\b", text)))
    add(bits["THEME_CLUE"], bool(re.search(r"\bclue\b", text)) or "investigate" in text)
    add(bits["THEME_COMBAT"], "additional combat" in text)
    add(bits["THEME_COPY"], bool(re.search(r"copy (target|that) (instant|sorcery|spell)", text)))
    add(bits["THEME_MODIFIED"], bool(re.search(r"\bmodified\b", text)))
    add(bits["THEME_CRIME"], "commit a crime" in text)
    add(bits["THEME_PLOT"], "plot" in keys)
    add(bits["THEME_CASCADE"], "cascade" in keys)
    add(bits["THEME_STORM"], "storm" in keys)
    add(bits["THEME_MUTATE"], "mutate" in keys)
    add(bits["THEME_NINJA"], "ninjutsu" in keys or "ninjutsu" in text)
    add(bits["THEME_ALLIANCE"], "alliance" in keys)
    add(bits["THEME_DESCEND"], "descend" in keys or bool(re.search(r"\bdescend", text)))
    return mask


def card_row(card: dict, bits: dict[str, int]) -> list:
    faces = card.get("card_faces") or []
    layout = card.get("layout") or ""
    if faces and layout in {"transform", "modal_dfc", "meld", "adventure", "flip", "split"}:
        oracle_parts: list[str] = []
        mask = 0
        subs: list[str] = []
        keywords = list(card.get("keywords") or [])
        for face in faces:
            oracle_parts.append(face.get("oracle_text") or "")
            keywords.extend(face.get("keywords") or [])
            face_mask, face_subs = parse_type(face.get("type_line") or "", bits)
            mask |= face_mask
            for sub in face_subs:
                if sub not in subs:
                    subs.append(sub)
        oracle = clean_oracle(" ".join(oracle_parts))
    else:
        oracle = clean_oracle(card.get("oracle_text") or "")
        keywords = list(card.get("keywords") or [])
        mask, subs = parse_type(card.get("type_line") or "", bits)
    if any(str(word).lower() == "changeling" for word in keywords):
        mask |= bits["TYPE_CHANGELING"]
    row: list = [int(round(card.get("cmc") or 0)), mask, theme_mask(oracle, keywords, bits)]
    if subs:
        row.append(subs)
    return row


def main() -> None:
    bits = load_bits()
    names, offers = collect_names()
    ordered = sorted(names)
    print(f"names {len(ordered)} offers {len(offers)}", flush=True)
    cache = fetch_cards(ordered)
    tags: dict[str, list] = {}
    missing_offers: list[str] = []
    missing_other = 0
    for name in ordered:
        card = cache.get(name)
        if not card or card.get("missing"):
            if name in offers:
                missing_offers.append(name)
            else:
                missing_other += 1
            continue
        tags[name] = card_row(card, bits)
        returned = card.get("name")
        if returned and returned not in tags:
            tags[returned] = tags[name]
    OUT.write_text(json.dumps(tags, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT} cards {len(tags)} missing_other {missing_other}", flush=True)
    if missing_offers:
        print("MISSING OFFERS", file=sys.stderr)
        for name in missing_offers:
            print(f"  {name}", file=sys.stderr)
        raise SystemExit(1)

    # Quick coverage check so thresholds can be tuned.
    precons = json.loads(PRECONS.read_text())
    theme_names = [name for name in bits if name.startswith("THEME_")]
    decks_over = {name: 0 for name in theme_names}
    tribe_decks = 0
    for deck in precons:
        counts: dict[str, int] = {}
        themes: dict[str, int] = {}
        for card in deck["commanders"] + deck["cards"]:
            row = tags.get(card["name"])
            if not row:
                continue
            qty = card["quantity"]
            mask = row[2]
            for theme in theme_names:
                if mask & bits[theme]:
                    themes[theme] = themes.get(theme, 0) + qty
            if row[1] & bits["TYPE_CREATURE"] and len(row) > 3:
                for sub in row[3]:
                    counts[sub] = counts.get(sub, 0) + qty
        if counts and max(counts.values()) >= 8:
            tribe_decks += 1
        for theme, count in themes.items():
            if count >= 3:
                decks_over[theme] += 1
    print("decks with a creature type at 8+", tribe_decks)
    for theme, count in sorted(decks_over.items(), key=lambda item: -item[1]):
        if count:
            print(f"  {count:3} {theme} (>=3 cards)")


if __name__ == "__main__":
    main()
