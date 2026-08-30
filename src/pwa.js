// 서비스워커 등록 + 업데이트 제어.
// 핵심 규칙: 자동 새로고침 금지. 새 버전은 "대기" 상태로 두고, 사용자가 applyUpdate()를
// 부를 때(=업데이트 버튼 탭)만 교체 후 새로고침한다. → 작성 중이던 입력이 날아가지 않는다.

let waitingWorker = null;
let userTriggered = false;
let refreshing = false;
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb(Boolean(waitingWorker));
}

// 업데이트 준비 상태 구독. 현재 대기 워커가 있으면 즉시 알린다.
export function onUpdateAvailable(cb) {
  listeners.add(cb);
  if (waitingWorker) cb(true);
  return () => listeners.delete(cb);
}

// 사용자가 "업데이트"를 눌렀을 때만 호출 → 대기 워커 활성화 → controllerchange에서 새로고침.
export function applyUpdate() {
  userTriggered = true;
  if (waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  } else {
    window.location.reload();
  }
}

export function registerSW() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return; // 개발 모드에선 SW를 등록하지 않는다(HMR 방해 방지).

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");

      // 이미 대기 중인 새 버전이 있으면(다른 탭에서 설치됨) 알림.
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker = reg.waiting;
        emit();
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // 기존 컨트롤러가 있는 상태에서 새 워커가 설치되면 = 업데이트 대기.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker = reg.waiting || installing;
            emit();
          }
        });
      });

      // 주기적으로 새 배포를 확인한다(탭을 오래 열어둔 경우).
      setInterval(() => reg.update().catch(() => {}), 60 * 1000);
    } catch (error) {
      console.error("서비스워커 등록 실패:", error);
    }
  });

  // 새 워커가 컨트롤을 넘겨받으면 새로고침 — 단, 사용자가 명시적으로 업데이트를 눌렀을 때만.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!userTriggered || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
