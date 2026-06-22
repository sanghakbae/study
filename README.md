# Study Math Arena

중학교/고등학교 수학을 게임형 스킬트리로 학습하는 React + Vite 앱입니다.

## 기능

- Google OAuth 로그인
- Firebase Firestore 저장
  - `users`: 사용자 프로필, XP, 풀이 수, 숙련 스킬
  - `skills`: 중등/고등 수학 스킬트리
  - `problems`: 단원별 문제
  - `attempts`: 풀이 기록, 필기 stroke, AI 가이드, 정답 여부
- 태블릿 중심 반응형 화면
  - 왼쪽: 펜/지우개 노트 캔버스
  - 오른쪽: OpenAI 가이드 패널
- 랭킹/XP 경쟁
- Cloudflare Pages Function `/api/guide`에서 OpenAI API 호출
- 문제 이미지/그래프는 Cloudflare R2(S3 호환)에 저장하고 Firestore 문제 문서의 `assets` 배열 URL로 참조

## 실행

```bash
npm install
npm run dev
```

로컬 URL:

```text
http://localhost:5173/
```

## 빌드

```bash
npm run build
```

## OpenAI 키

브라우저에 OpenAI 키를 노출하지 않습니다. Cloudflare Pages secret으로 넣습니다.

로컬에서 Cloudflare Pages Function까지 테스트하려면:

```bash
cp .dev.vars.example .dev.vars
```

그 다음 `.dev.vars`에 키를 넣습니다.

```text
OPENAI_API_KEY=sk-proj_...
OPENAI_MODEL=gpt-4.1-mini
```

실행:

```bash
npm run dev:pages
```

운영 배포용 secret:

```bash
npx wrangler pages secret put OPENAI_API_KEY --project-name study
```

선택 모델:

```bash
npx wrangler pages secret put OPENAI_MODEL --project-name study
```

## 배포

GitHub Actions가 `main` push 시 Cloudflare Pages로 배포합니다.

GitHub Secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Cloudflare Pages custom domain:

```text
study.sanghak.kr
```

## 문제 데이터 소스

현재 공개적으로 바로 붙일 수 있는 “한국 중/고 교과서 단원별 수학 문제 API”는 확인되지 않았습니다. 그래서 앱은 Firestore `problems` 표준 스키마를 먼저 만들고, 다음 소스를 흡수할 수 있게 설계했습니다.

- 교과서/문제집: 저작권 계약 후 관리자 업로드 권장
- 공공데이터포털/data.go.kr: 공개 API가 생기면 어댑터 추가
- AI Hub: 다운로드형 교육 데이터셋 약관 확인 후 변환 적재
- 공개 벤치마크: GSM8K, MATH, MathQA 등은 보충/챌린지 문제로만 사용 권장

앱 안의 `src/services/problemSources.js`가 이 소스 레지스트리입니다.

## 문제 이미지/그래프 저장

문제 문서 예시:

```json
{
  "id": "p-m2-functions-graph-01",
  "nodeId": "m2-functions",
  "title": "일차함수 그래프",
  "prompt": "그래프를 보고 직선의 기울기를 구하시오.",
  "answer": "2",
  "assets": [
    {
      "type": "graph",
      "label": "문제 그래프",
      "url": "https://assets.study.sanghak.kr/problems/m2-functions/graph-01.png"
    }
  ]
}
```

R2 버킷은 공개 읽기 도메인을 붙이고, 앱은 그 URL을 그대로 렌더링합니다. 원본 파일은 `problems/{nodeId}/{problemId}.{ext}` 같은 경로로 두면 관리가 쉽습니다.

## 주의

현재 `firestore.rules`는 초기 개발 편의를 위해 로그인 사용자가 `skills`, `problems`, `system` 초기 seed를 만들 수 있게 열려 있습니다. 운영 전에는 관리자 custom claim 또는 별도 import 스크립트로 카탈로그 쓰기를 제한해야 합니다.
