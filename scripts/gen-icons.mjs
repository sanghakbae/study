// 하나의 마스터 SVG(public/icon.svg)에서 홈 화면 아이콘·파비콘을 모두 생성한다.
// 색/모양을 바꾸려면 public/icon.svg 만 수정한 뒤 `npm run gen:icons` 를 실행하면 전부 따라온다.
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = resolve(ROOT, "public/icon.svg");
const ICONS_DIR = resolve(ROOT, "public/icons");
mkdirSync(ICONS_DIR, { recursive: true });

const svg = readFileSync(MASTER);

// 파비콘(SVG)도 같은 원본을 따라가도록 복사한다.
copyFileSync(MASTER, resolve(ROOT, "public/favicon.svg"));

const targets = [
  { file: "public/icons/icon-192.png", size: 192 },
  { file: "public/icons/icon-512.png", size: 512 },
  // maskable: 배경이 캔버스를 꽉 채우므로 동일 원본을 그대로 쓴다(안전영역 확보됨).
  { file: "public/icons/icon-192-maskable.png", size: 192 },
  { file: "public/icons/icon-512-maskable.png", size: 512 },
  // iOS 홈 화면 아이콘(투명도 없이 불투명 배경).
  { file: "public/icons/apple-touch-icon-180.png", size: 180 },
  // 파비콘 PNG 폴백.
  { file: "public/icons/favicon-32.png", size: 32 },
  { file: "public/icons/favicon-16.png", size: 16 },
];

for (const { file, size } of targets) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 17, g: 24, b: 39, alpha: 1 } })
    .png()
    .toFile(resolve(ROOT, file));
  console.log(`✓ ${file} (${size}×${size})`);
}

console.log("아이콘 생성 완료. (원본: public/icon.svg)");
