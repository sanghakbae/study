import { useEffect, useState } from "react";
import { onUpdateAvailable, applyUpdate } from "./pwa.js";

const IOS_DISMISS_KEY = "ios-install-dismissed-until";
const DAY_MS = 24 * 60 * 60 * 1000;

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true
  );
}

function shouldShowIosGuide() {
  const ua = window.navigator.userAgent || "";
  const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos || isStandalone()) return false;
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios|mercury/i.test(ua);
  if (!isSafari) return false;
  try {
    const until = Number(localStorage.getItem(IOS_DISMISS_KEY) || 0);
    if (Date.now() < until) return false;
  } catch {
    // localStorage may be unavailable.
  }
  return true;
}

function ShareGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <path d="M12 3v12M12 3l-4 4M12 3l4 4" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => onUpdateAvailable(setReady), []);

  if (!ready) return null;
  return (
    <div className="pwa-update-banner" role="status">
      <span className="pwa-update-text">새 버전이 있어요. 지금 업데이트할까요?</span>
      <button
        type="button"
        className="pwa-update-btn"
        disabled={applying}
        onClick={() => {
          setApplying(true);
          applyUpdate();
        }}
      >
        {applying ? "교체 중..." : "업데이트"}
      </button>
    </div>
  );
}

function IosInstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(shouldShowIosGuide());
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(IOS_DISMISS_KEY, String(Date.now() + DAY_MS));
    } catch {
      // Ignore storage failures.
    }
    setShow(false);
  }

  return (
    <div className="pwa-ios-banner" role="dialog" aria-label="홈 화면에 설치 안내">
      <div className="pwa-ios-icon" aria-hidden="true">📐</div>
      <div className="pwa-ios-body">
        <strong>홈 화면에 앱으로 추가하기</strong>
        <p>
          아래 <ShareGlyph /> <b>공유</b> 버튼을 누른 뒤, 목록을 내려 <b>'홈 화면에 추가'</b>를 선택하세요.
          보이지 않으면 <b>'더 보기'</b>를 눌러 찾으면 됩니다.
        </p>
      </div>
      <button type="button" className="pwa-ios-close" onClick={dismiss} aria-label="닫기">x</button>
    </div>
  );
}

export default function PwaBanners() {
  return (
    <>
      <UpdateBanner />
      <IosInstallBanner />
    </>
  );
}
