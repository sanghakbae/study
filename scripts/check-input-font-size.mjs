// 회귀 테스트: 입력칸(input·select·textarea)이 좁은 화면에서 16px 미만이 되지 않도록 고정.
// iOS는 16px 미만 입력칸에 포커스가 가면 화면을 통째로 확대하므로, 아래 두 가지를 보증한다.
//   1) 전용 토큰 --input-font-size 가 16px 이상으로 정의되어 있다.
//   2) @media (max-width: 768px) 안에서 input/select/textarea 를 그 토큰으로 강제하는 규칙이 있다.
// 실패하면 종료 코드 1. (npm run test:inputs)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(ROOT, "src/styles.css"), "utf8");

const errors = [];

// 1) 전용 토큰이 16px 이상인지
const tokenMatch = css.match(/--input-font-size:\s*([0-9.]+)px/);
if (!tokenMatch) {
  errors.push("--input-font-size 토큰이 정의되어 있지 않습니다 (px 단위로 선언하세요).");
} else if (Number(tokenMatch[1]) < 16) {
  errors.push(`--input-font-size 가 ${tokenMatch[1]}px 입니다. 16px 미만으로 내리지 마세요.`);
}

// 2) 좁은 화면 강제 규칙 존재 여부
const mobileBlocks = [...css.matchAll(/@media[^{]*max-width:\s*768px[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
const enforced = mobileBlocks.some((block) => {
  // input, select, textarea { ... font-size: var(--input-font-size) !important ... }
  return /(^|[},\s])(input|select|textarea)\b[\s\S]*?font-size:\s*var\(--input-font-size\)\s*!important/.test(block)
    || /(input\s*,\s*select\s*,\s*textarea|select\s*,\s*textarea\s*,\s*input)[\s\S]*?font-size:\s*var\(--input-font-size\)\s*!important/.test(css);
});
if (!enforced) {
  errors.push("@media (max-width: 768px) 안에서 input/select/textarea 를 var(--input-font-size) !important 로 강제하는 규칙이 없습니다.");
}

if (errors.length) {
  console.error("❌ 입력칸 폰트 크기 회귀 테스트 실패:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✅ 입력칸 폰트 크기 회귀 테스트 통과 (좁은 화면 16px 하한 유지).");
