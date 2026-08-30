// 수학학습 서비스워커 — 오프라인 실행 + 사용자가 눌러야 교체되는 업데이트.
// 버전 문자열은 배포 때 scripts/write-deploy-version.mjs 가 실제 커밋 해시로 치환한다.
// (치환되어야 sw.js 바이트가 바뀌고 브라우저가 새 버전을 감지한다.)
const VERSION = "__BUILD_VERSION__";
const CACHE = `study-app-${VERSION}`;

// 앱 셸 필수 자원(해시가 안 붙는 것들). 해시가 붙는 JS/CSS는 런타임에 캐시된다.
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => {}),
  );
  // 자동으로 skipWaiting 하지 않는다 — 사용자가 "업데이트"를 누를 때까지 대기한다.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("study-app-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// 앱에서 보낸 메시지로만 대기 중 워커를 활성화한다(사용자 탭 → 교체).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // 크로스 오리진(Firebase, Google 등)은 건드리지 않는다 → 온라인일 때만 동작.
  if (!isSameOrigin(request.url)) return;

  // 배포 버전 신호는 항상 네트워크(캐시 금지).
  if (url.pathname === "/deploy-version.json") return;

  // 페이지 이동: 네트워크 우선, 실패하면 캐시된 셸로 오프라인 실행.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  // 같은 오리진 정적 자원: 캐시 우선 + 백그라운드 갱신(stale-while-revalidate).
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    }),
  );
});
