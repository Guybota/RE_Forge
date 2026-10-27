import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/icons/icon.svg"));
const sizes = [48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512];

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(join(root, "public/icons", `icon-${size}.png`));
}

await sharp(svg).resize(512, 512).png().toFile(join(root, "public/icons/maskable-512.png"));
console.log(`Wrote ${sizes.length + 1} icons from public/icons/icon.svg`);
