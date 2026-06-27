import { createPortal } from "react-dom";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Award,
  BookOpen,
  Brush,
  ChevronRight,
  Crown,
  Eraser,
  Flame,
  Gamepad2,
  GraduationCap,
  ClipboardList,
  X,
  Hand,
  HelpCircle,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Medal,
  MousePointer2,
  PenLine,
  Printer,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  ScrollText,
  Trophy,
  TrendingUp,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import {
  completeOnboarding,
  ensureUserProfile,
  loadAuditLogsForUsers,
  loadAiUsageLogsForUsers,
  loadAttemptsForUsers,
  loadAllProblems,
  loadLeaderboard,
  loadProblemsBySkill,
  loadProgressForUsers,
  loadStudyProgressForUser,
  loadSkills,
  loadUsers,
  markGuideHelpUsed,
  markAiGuideUsed,
  markFirstLoginChatNotified,
  saveAiUsageLog,
  saveAuditLog,
  saveAttempt,
  awardBonusXp,
  saveExamResult,
  seedCatalogIfNeeded,
  suppressLoginGuideForSevenDays,
  updateUserRole,
  updateStudyLocation,
  upsertProblem,
} from "./services/firestore";
import { curriculumNodes } from "./data/curriculum";
import { generatedProblems, getProblemsForSkill, getProblemCountForSkill } from "./data/problemBank";
import { externalProblemSources } from "./services/problemSources";
import {
  GRADES,
  EXAM_PASS_RATIO,
  EXAM_PASS_BONUS,
  examSkillSplit,
  getExamPaper,
  examStatusesForGrade,
  allExamStatuses,
} from "./data/exams";

const fallbackUser = {
  displayName: "게스트",
  photoURL: "",
  role: "student",
  xp: 0,
  solvedCount: 0,
};

const guideActions = [
  { key: "concept", label: "개념 학습", icon: BookOpen },
  { key: "hint", label: "힌트 받기", icon: HelpCircle, xpPenalty: 0.2 },
  { key: "next", label: "풀이 방향", icon: ChevronRight, xpPenalty: 0.5 },
];

const guideXpPenaltyRates = new Map(
  guideActions
    .filter((action) => Number(action.xpPenalty) > 0)
    .map((action) => [action.key, Number(action.xpPenalty)]),
);

const notifyEndpoint = "/api/notify";

const gradeOptions = ["중1", "중2", "중3", "고1", "고2", "고3"];
const problemLookup = new Map(generatedProblems.map((problem) => [problem.id, problem]));
const defaultSkillId = "m1-numbers";
const defaultProblemId = "p-m1-numbers-01";
const skillOrder = new Map(curriculumNodes.map((skill, index) => [skill.id, index]));

function sortSkillsByCurriculumOrder(skillList = []) {
  return [...skillList].sort((a, b) => {
    const orderA = skillOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = skillOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.title || a.id).localeCompare(String(b.title || b.id), "ko");
  });
}

function getSequentialUnlockedSkills(skillList = [], completedSkillIds = []) {
  const completed = new Set(completedSkillIds);
  const unlocked = new Set(completedSkillIds);
  for (const skill of sortSkillsByCurriculumOrder(skillList)) {
    if (completed.has(skill.id)) continue;
    unlocked.add(skill.id);
    break;
  }
  return unlocked;
}

// 정답 비교용 정규화: 공백·괄호 제거, 유니코드 마이너스 통일, 소문자화.
export function normalizeMathAnswer(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/−/g, "-")
    .toLowerCase();
}

function normalizeCoefficient(value) {
  const raw = String(value ?? "").trim().replace(/−/g, "-").replace(/x/gi, "");
  if (!raw || raw === "+") return "1";
  if (raw === "-") return "-1";
  return raw.replace(/^\+/, "");
}

function parseTermConstantAnswer(value) {
  const raw = String(value ?? "")
    .replace(/−/g, "-")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase();
  if (!raw) return null;

  const labeledTerm = raw.match(/x\s*항\s*[:：]?\s*([+-]?\d*)\s*x?/);
  const labeledConstant = raw.match(/상수\s*항\s*[:：]?\s*([+-]?\d+)/);
  if (labeledTerm && labeledConstant) {
    return { coefficient: normalizeCoefficient(labeledTerm[1]), constant: labeledConstant[1].replace(/^\+/, "") };
  }

  const parts = raw
    .split(/[,\n;/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const coefficient = parts[0].match(/[+-]?\d*\s*x|[+-]?\d+/);
    const constant = parts[1].match(/[+-]?\d+/);
    if (coefficient && constant) {
      return { coefficient: normalizeCoefficient(coefficient[0]), constant: constant[0].replace(/^\+/, "") };
    }
  }

  const spacedTokens = raw.match(/[+-]?\d*\s*x|[+-]?\d+/g);
  if (spacedTokens?.length >= 2 && /[\s,;/]/.test(raw)) {
    return { coefficient: normalizeCoefficient(spacedTokens[0]), constant: spacedTokens[1].replace(/^\+/, "") };
  }
  return null;
}

function isTermConstantProblem(problem) {
  return /x\s*항.*상수\s*항/.test(String(problem?.prompt || "")) && /x\s*항.*상수\s*항/.test(String(problem?.answer || ""));
}

function isCorrectMathAnswer(input, answer, problem) {
  if (isTermConstantProblem(problem)) {
    const expected = parseTermConstantAnswer(answer);
    const submitted = parseTermConstantAnswer(input);
    if (expected && submitted) {
      return expected.coefficient === submitted.coefficient && expected.constant === submitted.constant;
    }
  }
  return normalizeMathAnswer(input) === normalizeMathAnswer(answer);
}

function getAnswerInputExample(problem) {
  if (!problem || problem.choices?.length) return "";
  if (isTermConstantProblem(problem)) {
    const parsed = parseTermConstantAnswer(problem.answer);
    if (parsed) return `입력 예: ${parsed.coefficient}, ${parsed.constant} 또는 x항: ${parsed.coefficient}x, 상수항: ${parsed.constant}`;
  }
  const answer = String(problem.answer ?? "").trim();
  if (!answer) return "입력 예: 12";
  if (/x\s*=/.test(answer) && /y\s*=/.test(answer)) return "입력 예: x=2, y=-1";
  if (/합\s*:/.test(answer) && /곱\s*:/.test(answer)) return "입력 예: 합: 5, 곱: 6";
  if (/면\s*:/.test(answer) && /꼭짓점\s*:/.test(answer)) return "입력 예: 면: 6, 꼭짓점: 8, 모서리: 12";
  if (/^\(.+\)$/.test(answer)) return "입력 예: (2, -3)";
  if (/^[+-]?\d+\s*,/.test(answer)) return "입력 예: -3, 0, 2";
  if (/^\d+\s*:\s*\d+/.test(answer)) return "입력 예: 4:9";
  if (/[+-]?\d+\/[+-]?\d+/.test(answer)) return "입력 예: 3/4";
  if (/±/.test(answer)) return "입력 예: ±√5";
  if (/√/.test(answer)) return "입력 예: 3√2";
  if (/°/.test(answer)) return "입력 예: 60°";
  if (/원/.test(answer)) return "입력 예: 1500원";
  if (/km/.test(answer)) return "입력 예: 120km";
  if (/cm³|m³/.test(answer)) return "입력 예: 12π cm³";
  if (/cm²|m²/.test(answer)) return "입력 예: 24cm²";
  if (/cm|m/.test(answer)) return "입력 예: 8cm";
  if (/π/.test(answer)) return "입력 예: 12π";
  if (/[a-zA-Z가-힣]\s*=/.test(answer)) return "입력 예: x=3";
  if (/[a-zA-Z]/.test(answer)) return "입력 예: 3x + 2";
  if (/제\d사분면/.test(answer)) return "입력 예: 제1사분면";
  if (/[가-힣]/.test(answer)) return "입력 예: 두 쌍의 대응하는 각이 각각 같다";
  return "입력 예: 12";
}

function getProblemOrder(problem) {
  const match = String(problem.id || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sortProblemsByNumber(problems) {
  return [...problems].sort((a, b) => getProblemOrder(a) - getProblemOrder(b) || String(a.id).localeCompare(String(b.id)));
}

function getFreshProblemGuide(problem, field) {
  if (!problem) return "";
  const generated = problemLookup.get(problem.id);
  return generated?.[field] || problem?.[field] || "";
}

// /api/guide(서버 함수)를 쓸 수 없는 환경(정적 호스팅 등)에서 보여줄 내장 가이드.
function getGuideFallback(actionKey, problem) {
  if (actionKey === "next") return getFreshProblemGuide(problem, "nextStep");
  if (actionKey === "hint") return getFreshProblemGuide(problem, "hint");
  // AI 가이드(내 풀이 점검)는 정적 환경에서 채점이 불가하므로 개념 정리로 대신 안내한다.
  const concept = getFreshProblemGuide(problem, "conceptGuide");
  return concept
    ? `## 내 풀이 점검\n- 지금 환경에서는 AI 풀이 점검을 사용할 수 없어, 개념 정리로 대신 안내합니다.\n\n${concept}`
    : "";
}

function chooseProblemId({ problems, savedLocation, skillId, solvedIds = [] }) {
  const solved = new Set(solvedIds);
  const savedProblemId = savedLocation.skillId === skillId ? savedLocation.problemId : "";
  // 저장된 위치가 아직 안 푼 문제면 그대로 이어서 푼다.
  if (savedProblemId && problems.some((problem) => problem.id === savedProblemId) && !solved.has(savedProblemId)) {
    return savedProblemId;
  }
  // 그 외에는 앞에서부터 아직 안 푼 첫 문제로 이동한다. (예: 1~3 풀고 멈췄으면 4번)
  const firstUnsolved = problems.find((problem) => !solved.has(problem.id));
  if (firstUnsolved) return firstUnsolved.id;
  // 모두 풀었으면 저장 위치나 첫 문제를 보여준다.
  if (savedProblemId && problems.some((problem) => problem.id === savedProblemId)) return savedProblemId;
  return problems[0]?.id || "";
}

function buildFirstLoginChatMessage(nextUser, nextProfile) {
  const loggedAt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date());

  return [
    "최초 로그인 알림",
    `이름: ${nextProfile.displayName || nextUser.displayName || "이름 없음"}`,
    `이메일: ${nextProfile.email || nextUser.email || "-"}`,
    `역할: ${nextProfile.role || "student"}`,
    `학년: ${nextProfile.grade || "-"}`,
    `UID: ${nextUser.uid}`,
    `시간: ${loggedAt}`,
  ].join("\n");
}

function DeployRefreshOverlay() {
  return (
    <div className="deploy-refresh-overlay" role="alert" aria-live="assertive">
      <div className="deploy-refresh-card">
        <Loader2 className="spin" size={24} />
        <strong>화면 조정 중입니다.</strong>
        <span>새 버전을 불러오는 중입니다. 잠시만 기다려주세요.</span>
      </div>
    </div>
  );
}

const ONBOARDING_KEY = "onboarding_done_v1";

const GUIDE_STEPS = [
  {
    selector: ".skill-panel",
    title: "스킬 트리",
    desc: "단원을 선택하면 해당 단원 문제가 나타납니다",
    side: "bottom",
  },
  {
    selector: ".problem-card",
    title: "문제 카드",
    desc: "문제를 확인하고 아래 필기 공간에 풀이를 적으세요",
    side: "bottom",
  },
  {
    selector: ".canvas-with-choices",
    title: "필기 & 정답",
    desc: "손으로 풀이를 쓰고 오른쪽에서 정답을 선택하세요",
    side: "top",
  },
  {
    selector: ".guide-actions",
    title: "풀이 도우미",
    desc: "막힐 때 힌트·풀이 방향·개념 보기를 눌러 도움을 받으세요",
    side: "left",
  },
];

function OnboardingGuide({ onDone }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  const updateRect = useCallback(() => {
    const el = document.querySelector(GUIDE_STEPS[step].selector);
    if (el) setRect(el.getBoundingClientRect());
  }, [step]);

  useEffect(() => {
    const el = document.querySelector(GUIDE_STEPS[step].selector);
    if (el) {
      // 대상이 화면 밖이면 먼저 화면 안으로 스크롤한 뒤 위치를 잰다.
      el.scrollIntoView({ block: "center", behavior: "auto" });
    }
    // 스크롤이 반영된 다음 프레임에 측정
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(updateRect);
    });
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [updateRect, step]);

  const current = GUIDE_STEPS[step];
  const isLast = step === GUIDE_STEPS.length - 1;
  const PAD = 6;

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 720;

  const calloutStyle = (() => {
    if (!rect) return {};
    const GAP = 16;
    // 모바일: 대상을 화면 안으로 스크롤한 뒤, 그 요소 위/아래 빈 공간에 말풍선을 붙인다.
    if (isMobile) {
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow > 170) {
        // 요소 아래에 충분한 공간이 있으면 아래에 표시
        return { left: 8, right: 8, top: rect.bottom + GAP, maxWidth: "none" };
      }
      // 아니면 요소 위에 표시
      return { left: 8, right: 8, bottom: window.innerHeight - rect.top + GAP, maxWidth: "none" };
    }
    switch (current.side) {
      case "bottom":
        return { left: Math.max(8, rect.left), top: rect.bottom + PAD + GAP, maxWidth: Math.min(280, window.innerWidth - 16) };
      case "top":
        return { left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + PAD + GAP, maxWidth: Math.min(280, window.innerWidth - 16) };
      case "left":
        return { right: window.innerWidth - rect.left + GAP, top: Math.min(rect.top, window.innerHeight - 200), maxWidth: 240 };
      case "right":
        return { left: rect.right + GAP, top: Math.min(rect.top, window.innerHeight - 200), maxWidth: 240 };
      default:
        return {};
    }
  })();

  if (!rect) return null;

  return createPortal(
    <div className="onboarding-overlay">
      <div
        className="onboarding-spotlight"
        style={{
          left: rect.left - PAD,
          top: rect.top - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }}
      />
      <div className={`onboarding-callout side-${current.side}`} style={calloutStyle}>
        <p className="onboarding-title">{current.title}</p>
        <p className="onboarding-desc">{current.desc}</p>
        <div className="onboarding-nav">
          <span className="onboarding-dots">
            {GUIDE_STEPS.map((_, i) => (
              <span key={i} className={`onboarding-dot ${i === step ? "active" : ""}`} />
            ))}
          </span>
          <div className="onboarding-btns">
            {step > 0 && (
              <button className="onboarding-prev" onClick={() => setStep((s) => s - 1)}>이전</button>
            )}
            {isLast ? (
              <button className="onboarding-next" onClick={onDone}>완료</button>
            ) : (
              <button className="onboarding-next" onClick={() => setStep((s) => s + 1)}>다음</button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function App() {
  const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
  const isManagerPath = normalizedPath === "/manager" || normalizedPath === "/admin";
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(fallbackUser);
  const [authReady, setAuthReady] = useState(false);
  const [skills, setSkills] = useState(curriculumNodes);
  const [selectedSkillId, setSelectedSkillId] = useState(defaultSkillId);
  const [problems, setProblems] = useState(() => {
    const skill = curriculumNodes.find((item) => item.id === defaultSkillId) || curriculumNodes[0];
    return getProblemsForSkill(skill);
  });
  const [selectedProblemId, setSelectedProblemId] = useState(defaultProblemId);
  const [leaderboard, setLeaderboard] = useState([]);
  const [members, setMembers] = useState([]);
  const [activityAttempts, setActivityAttempts] = useState([]);
  const [aiUsageLogs, setAiUsageLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [guide, setGuide] = useState("문제를 고르고 노트에 풀이를 시작하세요. 막히는 순간 오른쪽 버튼으로 힌트를 받을 수 있습니다.");
  const [guideLoading, setGuideLoading] = useState(false);
  const [pendingRole, setPendingRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [answerChecks, setAnswerChecks] = useState({});
  const [hintUsed, setHintUsed] = useState({});
  const [reviewCounts, setReviewCounts] = useState({});
  const [solvedBySkill, setSolvedBySkill] = useState({});
  const [acquiredSkill, setAcquiredSkill] = useState(null); // { skill, bonus } — 스킬 획득 축하 모달
  const [activeExam, setActiveExam] = useState(null); // 응시 중인 시험 { grade, type, key, title, paper }
  const [examResultModal, setExamResultModal] = useState(null); // 시험 결과 모달
  const [dataWarning, setDataWarning] = useState("");
  const [noteRatio, setNoteRatio] = useState(68);
  const [mobileSkillOpen, setMobileSkillOpen] = useState(true);
  const [pcSkillOpen, setPcSkillOpen] = useState(true);
  const [showLoginGuide, setShowLoginGuide] = useState(false);
  const [guideSuppressChecked, setGuideSuppressChecked] = useState(false);
  const [deployRefreshing, setDeployRefreshing] = useState(false);
  const [rankingModalOpen, setRankingModalOpen] = useState(false);
  const [wrongNotebookModalOpen, setWrongNotebookModalOpen] = useState(false);
  const [examUnlockNotice, setExamUnlockNotice] = useState(null);
  const notebookRef = useRef(null);
  const workspaceRef = useRef(null);
  // 스킬별 푼 문제 집합을 ref로도 들고 있어, 문제 로드 effect가 매 풀이마다 재실행되지 않으면서 최신 진행도를 참조한다.
  const solvedBySkillRef = useRef(solvedBySkill);
  const studyLocationTimerRef = useRef(null);
  const deployVersionRef = useRef("");
  const auditLoginRef = useRef("");
  const parentViewAuditRef = useRef("");
  const examSubmitLockRef = useRef(false);
  const savingProblemIdsRef = useRef(new Set());
  const examAvailabilityRef = useRef(null);

  const selectedSkill = useMemo(
    () => skills.find((item) => item.id === selectedSkillId) || skills[0],
    [selectedSkillId, skills],
  );

  const selectedProblem = useMemo(
    () => problems.find((item) => item.id === selectedProblemId) || problems[0] || getProblemsForSkill(curriculumNodes[0])[0],
    [selectedProblemId, problems],
  );

  useEffect(() => {
    if (!selectedProblem?.id) return;
    setGuide(getFreshProblemGuide(selectedProblem, "conceptGuide") || `## 개념 학습\n- ${selectedProblem.concept}`);
  }, [selectedProblem?.id]);

  useEffect(() => {
    let cancelled = false;
    let reloadTimer = 0;

    async function checkDeployVersion() {
      try {
        const response = await fetch(`/deploy-version.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        const nextVersion = String(data.version || "");
        if (!nextVersion) return;
        if (!deployVersionRef.current) {
          deployVersionRef.current = nextVersion;
          return;
        }
        if (deployVersionRef.current !== nextVersion && !cancelled) {
          setDeployRefreshing(true);
          window.clearTimeout(reloadTimer);
          reloadTimer = window.setTimeout(() => {
            window.location.reload();
          }, 1400);
        }
      } catch {
        // 배포 중 순간적인 404/네트워크 실패는 다음 주기에서 다시 확인한다.
      }
    }

    checkDeployVersion();
    const interval = window.setInterval(checkDeployVersion, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(reloadTimer);
    };
  }, []);

  useEffect(() => {
    localStorage.removeItem("study-note-ratio");
    // iOS PWA redirect 후 pendingRole 복원
    const savedRole = sessionStorage.getItem("pendingRole");
    if (savedRole) {
      setPendingRole(savedRole);
      sessionStorage.removeItem("pendingRole");
    }
    return onAuthStateChanged(auth, async (nextUser) => {
      setAuthReady(false);
      setUser(nextUser);
      if (nextUser) {
        setProfile({
          uid: nextUser.uid,
          displayName: nextUser.displayName || "수학 러너",
          photoURL: nextUser.photoURL || "",
          email: nextUser.email || "",
          role: nextUser.email === "totoriverce@gmail.com" ? "admin" : "student",
          xp: 0,
          solvedCount: 0,
        });
        try {
          const nextProfile = await ensureUserProfile(nextUser);
          setProfile((current) => ({ ...current, ...nextProfile }));
          const loginAuditKey = `${nextUser.uid}:${Number(nextUser.metadata?.lastSignInTime ? new Date(nextUser.metadata.lastSignInTime).getTime() : Date.now())}`;
          if (auditLoginRef.current !== loginAuditKey) {
            auditLoginRef.current = loginAuditKey;
            saveAuditLog({
              user: nextUser,
              action: "login",
              category: "auth",
              message: `${nextProfile.role || "student"} 로그인`,
              metadata: { role: nextProfile.role || "student", email: nextUser.email || "" },
            }).catch((error) => console.error("Audit login failed:", error));
          }
          if (nextProfile.firstLoginChatNotificationPending && !nextProfile.firstLoginChatNotifiedAt) {
            notifyFirstLogin(nextUser, nextProfile)
              .then(() => markFirstLoginChatNotified(nextUser.uid))
              .catch((error) => console.error("First login notification failed:", error));
          }
          setSelectedSkillId(nextProfile.lastSkillId || defaultSkillId);
          setSelectedProblemId(nextProfile.lastProblemId || defaultProblemId);
          if (!localStorage.getItem(ONBOARDING_KEY)) {
            setTimeout(() => setShowOnboarding(true), 800);
          }
          setAuthReady(true);
          (async () => {
            if (nextUser.email === "totoriverce@gmail.com") {
              await seedCatalogIfNeeded();
            }
            await refreshCatalog();
            setDataWarning("");
          })().catch((error) => {
            console.error(error);
            setDataWarning(`학습 데이터 동기화 실패: ${error.message}`);
          });
        } catch (error) {
          console.error(error);
          setDataWarning(`Firestore 연결/권한 확인 필요: ${error.message}`);
        }
      } else {
        setSolvedBySkill({});
        auditLoginRef.current = "";
        parentViewAuditRef.current = "";
      }
      setAuthReady(true);
    });
  }, []);

  async function notifyFirstLogin(nextUser, nextProfile) {
    const text = buildFirstLoginChatMessage(nextUser, nextProfile);
    await fetch(notifyEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  useEffect(() => {
    setReviewCounts(profile.aiGuideReviewCounts || {});
  }, [profile.aiGuideReviewCounts]);

  useEffect(() => {
    solvedBySkillRef.current = solvedBySkill;
  }, [solvedBySkill]);

  useEffect(() => {
    if (!user) return;
    const skill = skills.find((s) => s.id === selectedSkillId) || curriculumNodes.find((s) => s.id === selectedSkillId);
    const applyProblems = (items) => {
      const expectedCount = getProblemCountForSkill(selectedSkillId);
      const sourceProblems = items.length >= expectedCount ? items : getFallbackProblems(skill);
      const nextProblems = sortProblemsByNumber(sourceProblems).slice(0, expectedCount);
      const savedLocation = { skillId: profile.lastSkillId, problemId: profile.lastProblemId };
      const solvedIds = solvedBySkillRef.current[selectedSkillId] || [];
      const nextProblemId = chooseProblemId({ problems: nextProblems, savedLocation, skillId: selectedSkillId, solvedIds });
      setProblems(nextProblems);
      setSelectedProblemId(nextProblemId);
    };
    if (profile.role !== "admin") {
      applyProblems(getFallbackProblems(skill));
      return;
    }
    loadProblemsBySkill(selectedSkillId)
      .then((items) => {
        applyProblems(items);
      })
      .catch((error) => {
        console.error(error);
        applyProblems(getFallbackProblems(skill));
        setDataWarning("");
      });
  }, [selectedSkillId, user, profile.role, profile.lastSkillId, profile.lastProblemId, skills]);

  useEffect(() => {
    if (!authReady || !user || !selectedSkillId || !selectedProblemId) return;
    window.clearTimeout(studyLocationTimerRef.current);
    studyLocationTimerRef.current = window.setTimeout(() => {
      updateStudyLocation({ uid: user.uid, skillId: selectedSkillId, problemId: selectedProblemId }).catch((error) => {
        console.error(error);
      });
    }, 2000);
    return () => window.clearTimeout(studyLocationTimerRef.current);
  }, [authReady, selectedSkillId, selectedProblemId, user]);

  useEffect(() => {
    if (!authReady || !user || profile.role !== "parents") return;
    const childList = (profile.parentOf || []).join(",");
    const auditKey = `${user.uid}:${childList}`;
    if (parentViewAuditRef.current === auditKey) return;
    parentViewAuditRef.current = auditKey;
    saveAuditLog({
      user,
      action: "parent_view",
      category: "parent",
      message: "자녀 학습 현황 조회",
      metadata: { role: profile.role, parentOf: profile.parentOf || [] },
    }).catch((error) => console.error("Audit parent view failed:", error));
  }, [authReady, user, profile.role, profile.parentOf]);

  useEffect(() => {
    const shouldShowGuide =
      authReady &&
      user &&
      (profile.role || "student") === "student" &&
      profile.onboardingComplete &&
      Number(profile.loginGuideDismissUntil || 0) <= Date.now();
    setShowLoginGuide(Boolean(shouldShowGuide));
    if (shouldShowGuide) setGuideSuppressChecked(false);
  }, [authReady, user, profile.role, profile.onboardingComplete, profile.loginGuideDismissUntil]);

  async function refreshCatalog() {
    const uid = auth.currentUser?.uid;
    const shouldLoadCatalogFromDb = auth.currentUser?.email === "totoriverce@gmail.com";
    const [loadedSkills, loadedLeaders, studyProgress] = await Promise.all([
      shouldLoadCatalogFromDb ? loadSkills() : Promise.resolve([]),
      loadLeaderboard(),
      uid ? loadStudyProgressForUser(uid) : Promise.resolve({ solvedBySkill: {}, guideHelpUsed: {} }),
    ]);
    if (loadedSkills.length) setSkills(sortSkillsByCurriculumOrder(loadedSkills));
    setLeaderboard(loadedLeaders.filter((u) => u.role === "student" && u.onboardingComplete && !u.isMock));
    let me = loadedLeaders.find((item) => item.uid === uid);
    if (me) setProfile(me);
    setSolvedBySkill(studyProgress.solvedBySkill);
    if (uid) {
      setHintUsed((current) => {
        const merged = { ...studyProgress.guideHelpUsed };
        Object.entries(current).forEach(([problemId, actions]) => {
          const previous = Array.isArray(merged[problemId]) ? merged[problemId] : [];
          const next = Array.isArray(actions) ? actions : [];
          merged[problemId] = Array.from(new Set([...previous, ...next]));
        });
        return merged;
      });
    }
  }

  async function refreshMembers(nextProfile = profile) {
    if (!user || !["admin", "parents"].includes(nextProfile.role)) {
      setMembers([]);
      setAiUsageLogs([]);
      setAuditLogs([]);
      if (user && (nextProfile.role || "student") === "student") {
        const [attempts, progressDocs] = await Promise.all([
          loadAttemptsForUsers([user.uid]),
          loadProgressForUsers([user.uid]),
        ]);
        setActivityAttempts(mergeAttemptsWithProgress(attempts, progressDocs));
      } else {
        setActivityAttempts([]);
      }
      return;
    }

    const loadedUsers = await loadUsers();
    setMembers(loadedUsers);
    const targetUserIds =
      nextProfile.role === "admin"
        ? loadedUsers.filter((item) => item.role === "student").map((item) => item.uid)
        : nextProfile.parentOf || [];
    const auditTargetUserIds =
      nextProfile.role === "admin"
        ? loadedUsers.map((item) => item.uid)
        : Array.from(new Set([user.uid, ...(nextProfile.parentOf || [])].filter(Boolean)));
    const [attempts, progressDocs, usageLogs] = await Promise.all([
      loadAttemptsForUsers(targetUserIds),
      loadProgressForUsers(targetUserIds),
      loadAiUsageLogsForUsers(targetUserIds),
    ]);
    setActivityAttempts(mergeAttemptsWithProgress(attempts, progressDocs));
    setAiUsageLogs(usageLogs);
    try {
      setAuditLogs(await loadAuditLogsForUsers(auditTargetUserIds));
    } catch (error) {
      console.error("감사 로그 조회 실패:", error);
      setAuditLogs([]);
    }
  }

  useEffect(() => {
    if (!user || !["admin", "parents"].includes(profile.role)) return;
    refreshMembers().catch((error) => {
      console.error(error);
      setDataWarning(`회원/학습 기록 권한 확인 필요: ${error.message}`);
    });
  }, [profile.role, profile.parentOf, user]);

  const isIosPwa = () =>
    typeof window !== "undefined" &&
    window.navigator.standalone === true &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);

  // iOS PWA에서 redirect 후 돌아왔을 때 결과 처리
  useEffect(() => {
    if (!isIosPwa()) return;
    getRedirectResult(auth).catch(() => {});
  }, []);

  async function handleLogin(role) {
    setPendingRole(role);
    try {
      if (isIosPwa()) {
        // iOS PWA: 팝업 대신 redirect 사용 (sessionStorage 문제 우회)
        sessionStorage.setItem("pendingRole", role);
        await signInWithRedirect(auth, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (error) {
      setPendingRole(null);
      if (error.code === "auth/popup-blocked") {
        alert("팝업이 차단됐습니다.\n브라우저 주소창 오른쪽의 팝업 허용 아이콘을 클릭한 뒤 다시 시도해주세요.");
      } else if (error.code !== "auth/popup-closed-by-user") {
        alert(`Google 로그인 실패: ${error.message}`);
      }
    }
  }

  async function handleLogout() {
    const currentUser = auth.currentUser || user;
    if (currentUser) {
      try {
        await saveAuditLog({
          user: currentUser,
          action: "logout",
          category: "auth",
          message: `${profile.role || "student"} 로그아웃`,
          metadata: { role: profile.role || "student", email: currentUser.email || "" },
        });
      } catch (error) {
        console.error("Audit logout failed:", error);
      }
    }
    await signOut(auth);
  }

  async function handleDeniedLogout() {
    const currentUser = auth.currentUser || user;
    if (currentUser) {
      saveAuditLog({
        user: currentUser,
        action: "manager_access_denied",
        category: "auth",
        message: "관리자 페이지 권한 없음",
        metadata: { role: profile.role || "student", email: currentUser.email || "" },
      }).catch((error) => console.error("Audit denied failed:", error));
    }
    await handleLogout();
  }

  async function handleCompleteOnboarding({ role, grade }) {
    if (!user) return;
    const nextProfile = {
      ...profile,
      role,
      grade: role === "student" ? grade : "",
      parentOf: role === "parents" ? profile.parentOf || [] : [],
      onboardingComplete: true,
    };
    await completeOnboarding({ user, role, grade });
    setProfile(nextProfile);
    await refreshCatalog();
    if (["admin", "parents"].includes(nextProfile.role)) {
      await refreshMembers(nextProfile);
    }
  }

  async function handleDismissLoginGuide() {
    if (guideSuppressChecked && user) {
      try {
        await suppressLoginGuideForSevenDays(user.uid);
        setProfile((current) => ({ ...current, loginGuideDismissUntil: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
      } catch (error) {
        console.error(error);
        setDataWarning(`가이드 숨김 저장 실패: ${error.message}`);
      }
    }
    setShowLoginGuide(false);
  }

  function getGuidePenaltyRate(problemId) {
    const used = hintUsed[problemId];
    if (Array.isArray(used)) {
      return used.reduce((total, actionKey) => total + (guideXpPenaltyRates.get(actionKey) || 0), 0);
    }
    return (Number(used) || 0) * 0.05;
  }

  function trackHintUse(problemId, actionKey, nodeId = selectedSkillId) {
    setHintUsed((current) => {
      const previous = current[problemId];
      const used = Array.isArray(previous) ? previous : [];
      if (used.includes(actionKey)) return current;
      return { ...current, [problemId]: [...used, actionKey] };
    });
    if (!user || !nodeId) return;
    markGuideHelpUsed({ uid: user.uid, nodeId, problemId, actionKey }).catch((error) => {
      console.error(error);
      setDataWarning(`힌트 사용 기록 저장 실패: ${error.message}`);
    });
  }

  // AI 가이드(내 풀이 점검)만 /api/guide(OpenAI)로 생성한다. 힌트·풀이 방향은 내장 정적 가이드를 쓴다.
  // AI 사용 로그도 여기서 남는다.
  async function runAiGuide(action) {
    setGuideLoading(true);
    setGuide(`${action.label} 요청 중...`);
    try {
      const canvasImage = notebookRef.current?.exportCanvasImage?.() || null;
      const response = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action.label,
          problem: selectedProblem,
          noteSummary: notebookRef.current?.getStrokeSummary?.() || "",
          canvasImage,
        }),
      });
      // 일부 환경(특히 iOS Safari)에서는 JSON이 아닌 응답을 response.json()으로 파싱하면
      // "The string did not match the expected pattern" 예외가 난다. 텍스트로 받아 안전하게 파싱한다.
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          response.ok
            ? "서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요."
            : `요청 실패 (${response.status}). 잠시 후 다시 시도해 주세요.`,
        );
      }
      if (!response.ok) throw new Error(data.error || "OpenAI guide failed");
      if (data.usage) {
        await saveAiUsageLog({
          user,
          problem: selectedProblem,
          action: action.label,
          usage: data.usage,
          model: data.model,
        });
      }
      setGuide(data.guide);
      return true;
    } catch (error) {
      // 서버 함수를 쓸 수 없는 환경(정적 호스팅 등)에서는 내장 가이드로 자동 대체한다.
      const fallback = getGuideFallback(action.key, selectedProblem);
      if (fallback) {
        setGuide(fallback);
      } else {
        setGuide(`가이드를 불러오지 못했습니다.\n\n오류: ${error.message}\n\n잠시 후 다시 시도해 주세요.`);
      }
      return false;
    } finally {
      setGuideLoading(false);
    }
  }

  async function handleGuide(action) {
    if (action.key === "concept") {
      // 개념 학습은 기본 제공(정적)이므로 XP 패널티 집계(trackHintUse)에 넣지 않는다.
      setGuide(getFreshProblemGuide(selectedProblem, "conceptGuide") || `## 개념 학습\n- ${selectedProblem.concept}`);
      return;
    }

    // 풀이 방향 / 힌트 받기: 내장(정적) 가이드를 즉시 보여준다. OpenAI를 쓰지 않는다. (XP만 차감)
    if (action.key === "next") {
      trackHintUse(selectedProblem.id, action.key, selectedProblem.nodeId);
      setGuide(getFreshProblemGuide(selectedProblem, "nextStep") || `## 풀이 방향\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key === "hint") {
      trackHintUse(selectedProblem.id, action.key, selectedProblem.nodeId);
      setGuide(getFreshProblemGuide(selectedProblem, "hint") || `## 힌트\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key !== "check") return;

    if (answerChecks[selectedProblem.id]?.status !== "wrong") {
      setGuide("## 먼저 정답 확인\n- 내 풀이 점검은 정답 확인 후 틀렸을 때만 사용할 수 있습니다.\n- 맞았다면 자동으로 다음 문제로 넘어갑니다.");
      return;
    }

    const reviewKey = `${selectedProblem.id}`;
    const usedCount = reviewCounts[reviewKey] || 0;
    if (usedCount >= 1) {
      setGuide("## AI 가이드 사용 완료\n- AI 가이드는 문제당 1회만 사용할 수 있습니다.\n- 풀이 방향, 힌트, 개념 학습을 참고해서 다시 정리해 보세요.");
      return;
    }

    // 실제 AI 응답을 받은 경우에만 1회 사용으로 차감한다. (서버 호출 실패 시 차감하지 않아 재시도 가능)
    const ok = await runAiGuide(action);
    if (ok) {
      setReviewCounts((current) => ({ ...current, [reviewKey]: 1 }));
      markAiGuideUsed({ uid: user.uid, problemId: reviewKey }).catch((error) => {
        console.error(error);
        setDataWarning(`AI 가이드 사용 기록 저장 실패: ${error.message}`);
      });
    }
  }

  function markProblemCompleted(problemId, nodeId = selectedSkillId) {
    setSolvedBySkill((current) => {
      const solved = new Set(current[nodeId] || []);
      solved.add(problemId);
      return { ...current, [nodeId]: Array.from(solved) };
    });
  }

  function advanceToNextProblem(completedProblemId, nodeId = selectedSkillId) {
    const solved = new Set([...(solvedBySkillRef.current[nodeId] || solvedBySkill[nodeId] || []), completedProblemId]);
    const nextProblem = problems.find((problem) => problem.nodeId === nodeId && !solved.has(problem.id));
    if (nextProblem) {
      setSelectedProblemId(nextProblem.id);
      return;
    }
    const total = getProblemCountForSkill(nodeId);
    setGuide(`이 스킬의 ${total}문제를 모두 완료했습니다. 스킬 트리에서 다음 열린 스킬을 선택하세요.`);
  }

  async function completeProblem(problemOverride = selectedProblem, submittedAnswerOverride = "") {
    if (!user || !problemOverride) return;
    const problem = problemOverride;

    let completedSkillReward = null;
    const prevSolved = solvedBySkillRef.current[problem.nodeId] || solvedBySkill[problem.nodeId] || [];
    const alreadySolved = prevSolved.includes(problem.id);
    const total = getProblemCountForSkill(problem.nodeId);
    const wasComplete = prevSolved.length >= total;
    const nowComplete = !alreadySolved && prevSolved.length + 1 >= total;
    if (nowComplete && !wasComplete) {
      const skill = skills.find((s) => s.id === problem.nodeId) || curriculumNodes.find((s) => s.id === problem.nodeId);
      completedSkillReward = { skill, bonus: skill?.xp || 0 };
    }

    markProblemCompleted(problem.id, problem.nodeId);
    advanceToNextProblem(problem.id, problem.nodeId);

    const savingKey = `${user.uid}_${problem.id}`;
    if (savingProblemIdsRef.current.has(savingKey)) return;
    savingProblemIdsRef.current.add(savingKey);
    setSaving(true);

    const guidePenaltyRate = getGuidePenaltyRate(problem.id);
    const helpUsed = Array.isArray(hintUsed[problem.id]) ? hintUsed[problem.id] : [];
    const submittedAnswer = submittedAnswerOverride || answerChecks[problem.id]?.input || "";
    // 힌트 받기·풀이 방향만 정해진 비율로 XP를 차감한다. 개념 학습은 기본 제공이라 차감하지 않는다.
    const xpMultiplier = Math.max(0.3, 1 - guidePenaltyRate);

    try {
      const result = await saveAttempt({
        user,
        problem,
        strokes: notebookRef.current?.exportStrokes?.() || [],
        guide,
        isCorrect: true,
        status: "completed",
        xpMultiplier,
        submittedAnswer,
        helpUsed,
        alreadySolved,
      });
      if (result?.xpGain) {
        setProfile((current) => ({
          ...current,
          xp: (Number(current.xp) || 0) + result.xpGain,
          solvedCount: (Number(current.solvedCount) || 0) + 1,
        }));
      }
      if (completedSkillReward) {
        setAcquiredSkill(completedSkillReward);
        if (completedSkillReward.bonus) {
          try {
            await awardBonusXp({ user, amount: completedSkillReward.bonus });
            setProfile((current) => ({ ...current, xp: (Number(current.xp) || 0) + completedSkillReward.bonus }));
          } catch (error) {
            console.error("스킬 완주 보너스 지급 실패:", error);
          }
        }
      }
    } catch (error) {
      console.error(error);
      setDataWarning(`완료 기록 저장 실패: ${error.message}`);
    } finally {
      setSaving(false);
      savingProblemIdsRef.current.delete(savingKey);
    }
  }

  async function handleAnswerCheck(inputAnswer) {
    if (!user || !selectedProblem) return false;
    const correct = isCorrectMathAnswer(inputAnswer, selectedProblem.answer, selectedProblem);
    setAnswerChecks((current) => ({
      ...current,
      [selectedProblem.id]: {
        status: correct ? "correct" : "wrong",
        input: inputAnswer,
      },
    }));

    if (correct) {
      setGuide("정답입니다. 다음 문제로 넘어갑니다.");
      completeProblem(selectedProblem, inputAnswer);
      return true;
    }

    setGuide("정답이 아닙니다. 힌트나 풀이 방향을 눌러 어디서 어긋났는지 확인하세요.");
    const helpUsedWrong = Array.isArray(hintUsed[selectedProblem.id]) ? hintUsed[selectedProblem.id] : [];
    const localWrongAttempt = {
      id: `local-wrong-${selectedProblem.id}-${Date.now()}`,
      uid: user.uid,
      nodeId: selectedProblem.nodeId,
      problemId: selectedProblem.id,
      problemTitle: selectedProblem.title || selectedProblem.id,
      problemPrompt: selectedProblem.prompt || "",
      submittedAnswer: inputAnswer,
      helpUsed: helpUsedWrong,
      status: "wrong",
      wrong: true,
      completed: false,
      createdAt: Date.now(),
      pendingSync: true,
    };
    setActivityAttempts((current) => [localWrongAttempt, ...current]);
    try {
      await saveAttempt({
        user,
        problem: selectedProblem,
        strokes: notebookRef.current?.exportStrokes?.() || [],
        guide,
        isCorrect: false,
        status: "wrong",
        submittedAnswer: inputAnswer,
        helpUsed: helpUsedWrong,
      });
    } catch (error) {
      console.error(error);
      setDataWarning(`오답은 화면에 반영됐지만 DB 저장은 실패했습니다: ${error.message}`);
    }
    return false;
  }

  function handleStartExam(grade, type) {
    const paper = getExamPaper(grade, type);
    if (!paper || !paper.problems?.length) return;
    setActiveExam({
      grade,
      type,
      key: `${grade}-${type}`,
      title: paper.title || `${grade} ${type === "mid" ? "중간고사" : "기말고사"}`,
      paper,
    });
  }

  async function handleSubmitExam(correctCount) {
    if (!activeExam || examSubmitLockRef.current) return;
    examSubmitLockRef.current = true;
    const { key, type, title, paper } = activeExam;
    const total = paper.problems.length;
    const score = total ? Math.round((correctCount / total) * 100) : 0;
    const passed = total ? correctCount / total >= EXAM_PASS_RATIO : false;
    const alreadyPassed = !!profile.examResults?.[key]?.passed;
    const possibleBonus = passed && !alreadyPassed ? EXAM_PASS_BONUS[type] || 0 : 0;

    setActiveExam(null);
    try {
      const result = await saveExamResult({ user, key, score, total, passed, bonusXp: possibleBonus });
      const bonus = result?.awardedBonus ? possibleBonus : 0;
      setExamResultModal({ key, title, correct: correctCount, total, score, passed, bonus });
      setProfile((current) => {
        const previous = current.examResults?.[key];
        return {
          ...current,
          xp: (Number(current.xp) || 0) + bonus,
          examResults: {
            ...(current.examResults || {}),
            [key]: {
              score: Math.max(Number(previous?.score || 0), score),
              total,
              passed: Boolean(previous?.passed || passed),
              at: Date.now(),
              lastScore: score,
            },
          },
        };
      });
    } catch (error) {
      console.error("시험 결과 저장 실패:", error);
      setExamResultModal({ key, title, correct: correctCount, total, score, passed, bonus: 0 });
    } finally {
      examSubmitLockRef.current = false;
    }
  }

  const completedSkills = useMemo(() => {
    return skills
      .filter((skill) => (solvedBySkill[skill.id]?.length || 0) >= getProblemCountForSkill(skill.id))
      .map((skill) => skill.id);
  }, [skills, solvedBySkill]);

  const unlockedSkills = useMemo(() => {
    return getSequentialUnlockedSkills(skills, completedSkills);
  }, [skills, completedSkills]);

  const isStudentProfile = (profile.role || "student") === "student";
  const examRows = useMemo(
    () => (isStudentProfile ? allExamStatuses(completedSkills, profile.examResults || {}) : []),
    [completedSkills, profile.examResults, isStudentProfile],
  );
  const visibleExamRows = examRows.filter(
    (row) => row.mid.status !== "locked" || row.final.status !== "locked",
  );
  const availableExamList = visibleExamRows.flatMap((row) =>
    [row.mid, row.final].filter((exam) => exam.status === "available"),
  );
  const wrongNotebookItems = useMemo(
    () => (isStudentProfile ? buildWrongNotebookItems(activityAttempts.filter((attempt) => attempt.uid === user?.uid), solvedBySkill) : []),
    [activityAttempts, solvedBySkill, user?.uid, isStudentProfile],
  );
  const nextSkillAfterAcquired = acquiredSkill?.skill
    ? skills.find((skill) =>
      skill.id !== acquiredSkill.skill.id
      && unlockedSkills.has(skill.id)
      && (solvedBySkill[skill.id]?.length || 0) < getProblemCountForSkill(skill.id)
    )
    : null;

  useEffect(() => {
    if (!authReady || !user || profile.role !== "student") return;
    const keys = availableExamList.map((exam) => exam.key).sort();
    const previous = examAvailabilityRef.current;
    if (previous == null) {
      examAvailabilityRef.current = keys;
      return;
    }
    const openedKey = keys.find((key) => !previous.includes(key));
    examAvailabilityRef.current = keys;
    if (!openedKey) return;
    const openedExam = availableExamList.find((exam) => exam.key === openedKey);
    if (openedExam) setExamUnlockNotice(openedExam);
  }, [authReady, user, profile.role, availableExamList]);

  function handleSelectProblem(nodeId, problemId) {
    if (!nodeId || !problemId) return;
    setSelectedSkillId(nodeId);
    setSelectedProblemId(problemId);
    setWrongNotebookModalOpen(false);
  }

  if (!authReady) {
    return (
      <main className="loading-screen">
        {deployRefreshing && <DeployRefreshOverlay />}
        <Loader2 className="spin" size={34} />
      </main>
    );
  }

  if (!user) {
    return (
      <>
        {deployRefreshing && <DeployRefreshOverlay />}
        {isManagerPath ? <ManagerLoginScreen onLogin={() => handleLogin("admin")} /> : <LoginScreen onLogin={handleLogin} />}
      </>
    );
  }

  if (isManagerPath && profile.role !== "admin") {
    return (
      <>
        {deployRefreshing && <DeployRefreshOverlay />}
        <ManagerAccessDenied user={user} onLogout={handleDeniedLogout} />
      </>
    );
  }

  if (!profile.onboardingComplete && profile.role !== "admin") {
    return (
      <>
        {deployRefreshing && <DeployRefreshOverlay />}
        <OnboardingPage user={user} profile={profile} initialRole={pendingRole} onComplete={handleCompleteOnboarding} />
      </>
    );
  }

  if (profile.role === "admin") {
    return (
      <>
        {deployRefreshing && <DeployRefreshOverlay />}
        <AdminPage
          user={user}
          profile={profile}
          leaders={leaderboard}
          members={members}
          attempts={activityAttempts}
          auditLogs={auditLogs}
          aiUsageLogs={aiUsageLogs}
          onLogout={handleLogout}
          onRoleUpdate={async (payload) => {
            await updateUserRole(payload);
            await refreshMembers();
            await refreshCatalog();
          }}
        />
      </>
    );
  }

  if (profile.role === "parents") {
    return (
      <>
        {deployRefreshing && <DeployRefreshOverlay />}
        <ParentPage
          user={user}
          profile={profile}
          members={members}
          attempts={activityAttempts}
          leaders={leaderboard}
          onLogout={handleLogout}
          onRegisterChild={async (childUid) => {
            const parentOf = Array.from(new Set([...(profile.parentOf || []), childUid].filter(Boolean)));
            await updateUserRole({
              uid: user.uid,
              role: "parents",
              parentOf,
            });
            const nextProfile = { ...profile, parentOf };
            setProfile((current) => ({ ...current, parentOf }));
            await refreshMembers(nextProfile);
          }}
        />
      </>
    );
  }

  const topbarLeaders = buildActualLeaderboard(leaderboard, user.uid, profile);
  const topbarRank = topbarLeaders.findIndex((leader) => leader.uid === user.uid) + 1;

  return (
    <main className="app-shell">
      {showOnboarding && (
        <OnboardingGuide onDone={() => {
          localStorage.setItem(ONBOARDING_KEY, "1");
          setShowOnboarding(false);
        }} />
      )}
      {deployRefreshing && <DeployRefreshOverlay />}
      {dataWarning && <div className="warning-bar">{dataWarning}</div>}
      <Topbar
        user={user}
        profile={profile}
        rank={topbarRank || 0}
        wrongCount={wrongNotebookItems.length}
        onWrongNotebookClick={() => setWrongNotebookModalOpen(true)}
        onRankClick={() => setRankingModalOpen(true)}
        onLogout={handleLogout}
      />
      {showLoginGuide && (
        <LoginGuideModal
          suppressChecked={guideSuppressChecked}
          onSuppressChange={setGuideSuppressChecked}
          onClose={handleDismissLoginGuide}
        />
      )}

      {acquiredSkill && (
        <SkillAcquiredModal
          skill={acquiredSkill.skill}
          bonus={acquiredSkill.bonus}
          nextSkill={nextSkillAfterAcquired}
          availableExam={availableExamList[0]}
          onClose={() => setAcquiredSkill(null)}
          onNextSkill={() => {
            if (!nextSkillAfterAcquired) return;
            setAcquiredSkill(null);
            setSelectedSkillId(nextSkillAfterAcquired.id);
          }}
          onStartExam={(exam) => {
            setAcquiredSkill(null);
            handleStartExam(exam.grade, exam.type);
          }}
        />
      )}
      {examUnlockNotice && (
        <ExamUnlockModal
          exam={examUnlockNotice}
          onClose={() => setExamUnlockNotice(null)}
          onStart={() => {
            const exam = examUnlockNotice;
            setExamUnlockNotice(null);
            handleStartExam(exam.grade, exam.type);
          }}
        />
      )}
      {activeExam && (
        <ExamModal exam={activeExam} onSubmit={handleSubmitExam} onCancel={() => setActiveExam(null)} />
      )}
      {examResultModal && (
        <ExamResultModal
          result={examResultModal}
          onClose={() => setExamResultModal(null)}
          onRetry={() => {
            const grade = examResultModal.key.split("-")[0];
            const type = examResultModal.key.split("-")[1];
            setExamResultModal(null);
            handleStartExam(grade, type);
          }}
        />
      )}
      {rankingModalOpen && (
        <AppModal title="랭킹" icon={Crown} onClose={() => setRankingModalOpen(false)}>
          <Leaderboard leaders={leaderboard} currentUid={user.uid} profile={profile} />
        </AppModal>
      )}
      {wrongNotebookModalOpen && (
        <AppModal title="오답노트" icon={ClipboardList} onClose={() => setWrongNotebookModalOpen(false)}>
          <WrongNotebookModalContent items={wrongNotebookItems} onSelectProblem={handleSelectProblem} />
        </AppModal>
      )}

      <section className="dashboard-strip">
        <SkillTree
          skills={skills}
          selectedSkillId={selectedSkillId}
          completedSkills={completedSkills}
          solvedBySkill={solvedBySkill}
          unlockedSkills={unlockedSkills}
          onSelect={setSelectedSkillId}
          mobileCollapsed={!mobileSkillOpen}
          onMobileToggle={() => setMobileSkillOpen((open) => !open)}
          pcCollapsed={!pcSkillOpen}
          onPcToggle={() => setPcSkillOpen((open) => !open)}
        />
      </section>

      {visibleExamRows.length > 0 && <ExamCenter rows={visibleExamRows} onStart={handleStartExam} />}

      <section
        className="workspace"
        ref={workspaceRef}
        style={{ gridTemplateColumns: `minmax(0, ${noteRatio}%) 8px minmax(0, 1fr)` }}
      >
        <NotebookPanel
          ref={notebookRef}
          skill={selectedSkill}
          problems={problems}
          selectedProblem={selectedProblem}
          selectedProblemId={selectedProblemId}
          setSelectedProblemId={setSelectedProblemId}
          answerCheck={answerChecks[selectedProblem.id]}
          saving={saving}
          solvedCount={solvedBySkill[selectedSkillId]?.length || 0}
          totalProblemCount={getProblemCountForSkill(selectedSkillId)}
          solvedIds={solvedBySkill[selectedSkillId] || []}
          guidePenaltyRate={getGuidePenaltyRate(selectedProblem?.id)}
          onAnswerCheck={handleAnswerCheck}
        />

        <ResizeHandle workspaceRef={workspaceRef} onResize={setNoteRatio} />

        <GuidePanel
          problem={selectedProblem}
          guide={guide}
          guideLoading={guideLoading}
          reviewCount={reviewCounts[selectedProblem.id] || 0}
          answerCheck={answerChecks[selectedProblem.id]}
          isAdmin={profile.role === "admin"}
          onGuide={handleGuide}
        />
      </section>

      <section className="source-band">
        <div className="section-title">
          <Sparkles size={18} />
          <h2>문제 소스 파이프라인</h2>
        </div>
        <div className="source-grid">
          {externalProblemSources.map((source) => (
            <article className="source-card" key={source.id}>
              <strong>{source.name}</strong>
              <span>{source.type}</span>
              <p>{source.note}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function WrongNotebookModalContent({ items, onSelectProblem }) {
  return (
    <div className="wrong-note-card modal-wrong-note">
      {items.length ? (
        <>
        <div className="wrong-note-head">
          <div>
            <span>복습 대기</span>
            <strong>{items.length}개</strong>
          </div>
        </div>
        <div className="wrong-note-list">
          {items.map((item) => (
            <button type="button" key={`${item.nodeId}-${item.problemId}`} onClick={() => onSelectProblem(item.nodeId, item.problemId)}>
              <span>{item.category}</span>
              <strong>{item.prompt || item.problemId}</strong>
              <em>오답 {item.count}회</em>
            </button>
          ))}
        </div>
        </>
      ) : (
        <p>복습할 오답이 없습니다. 틀린 문제는 자동으로 여기에 모입니다.</p>
      )}
    </div>
  );
}

// 스킬의 모든 문제를 완료하면 뜨는 축하 모달.
function SkillAcquiredModal({ skill, bonus, nextSkill, availableExam, onClose, onNextSkill, onStartExam }) {
  if (!skill) return null;
  return (
    <div className="skill-acquired-backdrop" role="dialog" aria-modal="true" aria-labelledby="skill-acquired-title" onClick={onClose}>
      <div className="skill-acquired-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confetti-layer" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className={`confetti c${i % 6}`} style={{ left: `${(i * 4.1) % 100}%`, animationDelay: `${(i % 8) * 0.12}s` }} />
          ))}
        </div>
        <div className="skill-acquired-badge">
          <Trophy size={46} />
        </div>
        <p className="skill-acquired-eyebrow">SKILL UNLOCKED</p>
        <h2 id="skill-acquired-title">스킬 획득!</h2>
        <p className="skill-acquired-name">{skill.title}</p>
        <p className="skill-acquired-meta">{skill.stage} · {skill.unit}</p>
        {bonus ? <p className="skill-acquired-xp">+{bonus.toLocaleString()} XP 보너스</p> : null}
        <div className="skill-acquired-actions">
          {nextSkill && (
            <button type="button" className="skill-acquired-btn primary" onClick={onNextSkill}>
              다음 스킬
            </button>
          )}
          {availableExam && (
            <button type="button" className="skill-acquired-btn exam" onClick={() => onStartExam(availableExam)}>
              {availableExam.title} 도전
            </button>
          )}
          <button type="button" className="skill-acquired-btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function ExamUnlockModal({ exam, onClose, onStart }) {
  return (
    <div className="exam-result-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="exam-result-modal passed" onClick={(event) => event.stopPropagation()}>
        <div className="exam-result-icon"><GraduationCap size={42} /></div>
        <p className="exam-result-eyebrow">시험 해금</p>
        <h2>{exam.title} 열림</h2>
        <p className="exam-result-note">스킬 조건을 채워서 응시할 수 있습니다.</p>
        <div className="exam-result-actions">
          <button type="button" className="exam-result-retry" onClick={onStart}>바로 응시</button>
          <button type="button" className="exam-result-close" onClick={onClose}>나중에</button>
        </div>
      </div>
    </div>
  );
}

// 학년별 중간/기말 시험 현황 + 응시 버튼.
function ExamCenter({ rows, onStart }) {
  const hasAnyPaper = rows.some((row) => row.mid.hasPaper || row.final.hasPaper);
  if (!hasAnyPaper) return null;
  const cell = (exam) => {
    const label = exam.type === "mid" ? "중간고사" : "기말고사";
    if (exam.status === "passed") {
      return (
        <div className={`exam-chip passed`} key={exam.key}>
          <ClipboardList size={15} />
          <span>{label}</span>
          <em>합격 {exam.score != null ? `· ${exam.score}점` : ""}</em>
        </div>
      );
    }
    if (exam.status === "available") {
      return (
        <button type="button" className="exam-chip available" key={exam.key} onClick={() => onStart(exam.grade, exam.type)}>
          <ClipboardList size={15} />
          <span>{label}</span>
          <em>응시하기</em>
        </button>
      );
    }
    return (
      <div className="exam-chip locked" key={exam.key}>
        <Lock size={14} />
        <span>{label}</span>
        <em>{exam.type === "mid" ? "스킬 절반 필요" : "스킬 전부 필요"}</em>
      </div>
    );
  };
  return (
    <section className="exam-center">
      <div className="section-title">
        <GraduationCap size={18} />
        <h2>시험 센터</h2>
        <span className="exam-center-hint">스킬 절반 → 중간고사, 전부 → 기말고사 · 60점 이상 합격</span>
      </div>
      <div className="exam-grade-grid">
        {rows.map((row) => (
          <article className={`exam-grade-card ${row.mid.status === "passed" && row.final.status === "passed" ? "done" : ""}`} key={row.grade}>
            <h3>{row.grade}</h3>
            <div className="exam-grade-chips">
              {cell(row.mid)}
              {cell(row.final)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// 시험 응시 모달: 문제를 한 문항씩 풀고 마지막에 채점한다.
function ExamModal({ exam, onSubmit, onCancel }) {
  const problems = exam.paper.problems || [];
  const total = problems.length;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const problem = problems[index];
  const answered = Object.keys(answers).filter((k) => String(answers[k] ?? "").trim() !== "").length;

  function setAnswer(value) {
    setAnswers((current) => ({ ...current, [index]: value }));
  }

  async function grade() {
    if (submitting) return;
    setSubmitting(true);
    let correct = 0;
    problems.forEach((p, i) => {
      if (normalizeMathAnswer(answers[i]) && isCorrectMathAnswer(answers[i], p.answer, p)) correct += 1;
    });
    try {
      await onSubmit(correct);
    } catch (error) {
      console.error("시험 제출 실패:", error);
      setSubmitting(false);
    }
  }

  const isLast = index === total - 1;
  return (
    <div className="exam-backdrop" role="dialog" aria-modal="true">
      <div className="exam-modal">
        <header className="exam-modal-head">
          <div>
            <p className="exam-modal-eyebrow">{exam.type === "mid" ? "중간고사" : "기말고사"}</p>
            <h2>{exam.title}</h2>
          </div>
          <button type="button" className="exam-close" onClick={onCancel} aria-label="시험 닫기"><X size={20} /></button>
        </header>
        <div className="exam-progress">
          <div className="exam-progress-bar"><span style={{ width: `${total ? ((index + 1) / total) * 100 : 0}%` }} /></div>
          <span className="exam-progress-text">{index + 1} / {total} · 답한 문항 {answered}</span>
        </div>
        <div className="exam-question">
          <p className="exam-q-num">문제 {index + 1}</p>
          <p className="exam-q-prompt">{problem.prompt}</p>
          {Array.isArray(problem.choices) && problem.choices.length > 0 ? (
            <div className="exam-choices">
              {problem.choices.map((choice, i) => (
                <button
                  key={i}
                  type="button"
                  className={`exam-choice ${answers[index] === choice ? "selected" : ""}`}
                  onClick={() => setAnswer(choice)}
                >
                  <span className="exam-choice-num">{"①②③④⑤"[i] || i + 1}</span>
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <input
              className="exam-input"
              value={answers[index] ?? ""}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="답을 입력하세요"
            />
          )}
        </div>
        <footer className="exam-modal-foot">
          <button type="button" className="exam-nav" disabled={index === 0 || submitting} onClick={() => setIndex((i) => Math.max(0, i - 1))}>이전</button>
          {isLast ? (
            <button type="button" className="exam-submit" disabled={submitting} onClick={grade}>{submitting ? "제출 중" : "제출하고 채점"}</button>
          ) : (
            <button type="button" className="exam-nav primary" disabled={submitting} onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>다음</button>
          )}
        </footer>
      </div>
    </div>
  );
}

// 시험 결과 모달.
function ExamResultModal({ result, onClose, onRetry }) {
  const { title, correct, total, score, passed, bonus } = result;
  return (
    <div className="exam-result-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`exam-result-modal ${passed ? "passed" : "failed"}`} onClick={(event) => event.stopPropagation()}>
        <div className="exam-result-icon">{passed ? <Trophy size={42} /> : <RefreshCw size={40} />}</div>
        <p className="exam-result-eyebrow">{title}</p>
        <h2>{passed ? "합격!" : "불합격"}</h2>
        <p className="exam-result-score">{score}점 <span>({correct} / {total})</span></p>
        {passed && bonus ? <p className="exam-result-bonus">+{bonus.toLocaleString()} XP 보너스</p> : null}
        {!passed && <p className="exam-result-note">60점 이상이면 합격입니다. 다시 도전해보세요!</p>}
        <div className="exam-result-actions">
          {!passed && <button type="button" className="exam-result-retry" onClick={onRetry}>다시 응시</button>}
          <button type="button" className="exam-result-close" onClick={onClose}>확인</button>
        </div>
      </div>
    </div>
  );
}

function AdminPage({ user, profile, members, attempts, auditLogs, aiUsageLogs, onRoleUpdate, onLogout }) {
  const [activeMenu, setActiveMenu] = useState("stats");

  return (
    <main className="app-shell admin-shell">
      <Topbar user={user} profile={profile} onLogout={onLogout} />
      <section className="admin-layout">
        <aside className="admin-sidebar">
          <button className={activeMenu === "members" ? "active" : ""} onClick={() => setActiveMenu("members")}>
            <Users size={16} />
            회원 관리
          </button>
          <button className={activeMenu === "stats" ? "active" : ""} onClick={() => setActiveMenu("stats")}>
            <TrendingUp size={16} />
            학습 통계
          </button>
          <button className={activeMenu === "problems" ? "active" : ""} onClick={() => setActiveMenu("problems")}>
            <BookOpen size={16} />
            문제 관리
          </button>
          <button className={activeMenu === "audit" ? "active" : ""} onClick={() => setActiveMenu("audit")}>
            <ScrollText size={16} />
            감사 로그
          </button>
          <button className={activeMenu === "ai" ? "active" : ""} onClick={() => setActiveMenu("ai")}>
            <Wand2 size={16} />
            AI 사용량
          </button>
        </aside>
        {activeMenu === "members" ? (
          <section className="admin-panel">
            <div className="section-title">
              <ShieldCheck size={18} />
              <h2>회원 관리</h2>
            </div>
            <MemberManager members={members} onRoleUpdate={onRoleUpdate} />
          </section>
        ) : activeMenu === "audit" ? (
          <AdminAuditLog members={members} auditLogs={auditLogs} />
        ) : activeMenu === "ai" ? (
          <AdminAiUsage members={members} usageLogs={aiUsageLogs} />
        ) : activeMenu === "problems" ? (
          <AdminProblemManager
            onSaveProblem={async (problem) => {
              await upsertProblem(problem);
            }}
          />
        ) : (
          <AdminLearningDashboard members={members} attempts={attempts} />
        )}
      </section>
    </main>
  );
}

function ParentPage({ user, profile, members, attempts, leaders, onRegisterChild, onLogout }) {
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [weeklyReportChecked, setWeeklyReportChecked] = useState(false);
  const childIds = new Set(profile?.parentOf || []);
  const students = members.filter((member) => member.role === "student");
  const children = members.filter((member) => member.role === "student" && childIds.has(member.uid));
  const reportAttempts = buildFallbackAttemptsForChildren(children, attempts);
  const primaryChild = children[0] || null;

  useEffect(() => {
    if (weeklyReportChecked || !children.length) return;
    setWeeklyReportChecked(true);
    const weekKey = getISOWeekKey();
    if (localStorage.getItem("weekly_report_shown") !== weekKey) {
      localStorage.setItem("weekly_report_shown", weekKey);
      setReportModalOpen(true);
    }
  }, [weeklyReportChecked, children.length]);

  return (
    <main className="app-shell parent-shell">
      <Topbar user={user} profile={profile} onLogout={onLogout} />
      {reportModalOpen && (
        <ParentReportModal
          children={children}
          attempts={reportAttempts}
          allStudents={students}
          onClose={() => setReportModalOpen(false)}
          onPrint={() => window.print()}
        />
      )}
      <section className="parent-layout">
        <ParentInsightPanel
          profile={profile}
          members={members}
          attempts={attempts}
          onRegisterChild={onRegisterChild}
          onReportOpen={() => setReportModalOpen(true)}
          reportDisabled={!children.length}
        />
        <Leaderboard
          leaders={leaders}
          currentUid={primaryChild?.uid || user.uid}
          profile={primaryChild || profile}
          showMyStats={false}
          preview={false}
        />
      </section>
      <LearningPrintReports students={children} attempts={reportAttempts} allStudents={students} />
    </main>
  );
}

function ParentReportModal({ children, attempts, allStudents, onClose, onPrint }) {
  const period = getCurrentMonthPeriod();
  const rankedStudents = [...allStudents].sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const avgXp = allStudents.length ? Math.round(allStudents.reduce((sum, student) => sum + (Number(student.xp) || 0), 0) / allStudents.length) : 0;
  const avgSolved = allStudents.length ? Math.round(allStudents.reduce((sum, student) => sum + (Number(student.solvedCount) || 0), 0) / allStudents.length) : 0;

  return (
    <div className="parent-report-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="parent-report-title">
      <div className="parent-report-modal">
        <div className="parent-report-modal-head">
          <div>
            <h2 id="parent-report-title">주간 자녀 학습 리포트</h2>
            <p>{period.label} · {children.length}명의 자녀 현황을 확인하고 PDF로 저장합니다.</p>
          </div>
          <div className="parent-report-modal-head-actions">
            <button type="button" className="prm-btn-save" onClick={onPrint}>
              <Printer size={13} />
              PDF 저장
            </button>
            <button type="button" className="prm-btn-close" onClick={onClose}>닫기</button>
          </div>
        </div>
        <div className="parent-report-modal-list">
          {children.map((child) => {
            const childAttempts = attempts.filter((attempt) => attempt.uid === child.uid);
            const monthAttempts = childAttempts.filter((attempt) => {
              const time = getAttemptTime(attempt);
              return time >= period.startTime && time <= period.endTime;
            });
            const dashboard = buildChildDashboard({
              child,
              attempts: childAttempts,
              students: allStudents,
              rankIndex: rankedStudents.findIndex((item) => item.uid === child.uid),
              avgXp,
              avgSolved,
            });
            return (
              <article key={child.uid} className="parent-report-preview-card">
                <div className="parent-report-preview-head">
                  <div>
                    <strong>{formatStudentName(child)}</strong>
                    <span>{child.email || "이메일 없음"}</span>
                  </div>
                  <b>{Number(child.xp || 0).toLocaleString()} XP</b>
                </div>
                <div className="parent-report-preview-grid">
                  <div>
                    <span>전체 해결</span>
                    <strong>{Number(child.solvedCount) || 0}문제</strong>
                  </div>
                  <div>
                    <span>이번 달 활동</span>
                    <strong>{monthAttempts.length}건</strong>
                  </div>
                  <div>
                    <span>현재 단원</span>
                    <strong>{dashboard.summary[0]?.value || "-"}</strong>
                  </div>
                  <div>
                    <span>전체 순위</span>
                    <strong>{dashboard.growth[2]?.value || "-"}</strong>
                  </div>
                </div>
                <div className="parent-report-preview-note">
                  <span>최근 7일 해결: {dashboard.summary[2]?.value || "-"}</span>
                  <span>반복 오답: {dashboard.risks[0]?.value || "없음"}</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getISOWeekKey() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function isMonthEnd(date) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + 1);
  return nextDate.getMonth() !== date.getMonth();
}

function getCurrentMonthPeriod(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  const label = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
  return { startTime: start.getTime(), endTime: end.getTime(), label };
}

const SHARE_TEXT = `📐 Study Math Arena
중등부터 고등까지, 스킬을 열며 푸는 수학 학습 플랫폼입니다.

✅ 스킬 트리 방식으로 단계별 수학 학습
✅ AI 풀이 도우미로 막히는 문제 즉시 해결
✅ 손글씨 필기 공간과 오답 노트 제공
✅ 랭킹·XP 시스템으로 동기 부여
✅ 학부모 자녀 학습 리포트 제공

👉 https://study.sanghak.kr`;

function ShareButton() {
  const [copied, setCopied] = useState(false);
  function handleShare() {
    navigator.clipboard.writeText(SHARE_TEXT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button type="button" className={`icon-button share-btn ${copied ? "copied" : ""}`} onClick={handleShare} aria-label="공유">
      <Share2 size={16} />
      <span className="topbar-menu-label">{copied ? "복사됨!" : "공유"}</span>
    </button>
  );
}

function Topbar({ user, profile, rank = 0, wrongCount = 0, onWrongNotebookClick, onRankClick, onLogout }) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">
          <Gamepad2 size={22} />
        </div>
        <div>
          <strong>Study <span className="brand-line2">Math Arena</span></strong>
          <span>중등부터 고등까지, 스킬을 열며 푸는 수학</span>
        </div>
      </div>

      <div className="topbar-actions">
        {(profile.role || "student") === "student" && (
          <button type="button" className="stat-pill wrong-pill" onClick={onWrongNotebookClick} aria-label="오답노트 열기">
            <ClipboardList size={16} />
            <span>{wrongCount}</span>
            <span className="topbar-menu-label">오답노트</span>
          </button>
        )}
        {(profile.role || "student") === "student" && (
          <button type="button" className="stat-pill rank-pill" onClick={onRankClick} aria-label="랭킹 열기">
            <Crown size={16} />
            <span>{rank > 0 ? `#${rank}` : "-"}</span>
            <span className="topbar-menu-label">랭킹</span>
          </button>
        )}
        {(profile.role || "student") === "student" && (
          <div className="stat-pill">
            <Flame size={16} />
            <span>{profile.xp || 0} XP</span>
          </div>
        )}
        <div className="user-pill">
          {user.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound size={18} />}
          <span>{maskName(user.displayName) || "러너"}</span>
        </div>
        <ShareButton />
        <button className="icon-button" onClick={onLogout || (() => signOut(auth))} aria-label="로그아웃">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function AppModal({ children, title, icon: Icon = Crown, onClose }) {
  return (
    <div className="ranking-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="app-modal-title" onClick={onClose}>
      <div className="ranking-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ranking-modal-head">
          <div className="section-title">
            <Icon size={18} />
            <h2 id="app-modal-title">{title}</h2>
          </div>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label={`${title} 닫기`}>
            <X size={18} />
          </button>
        </div>
        <div className="ranking-modal-body">{children}</div>
      </div>
    </div>
  );
}

function LoginGuideModal({ suppressChecked, onSuppressChange, onClose }) {
  return (
    <div className="login-guide-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-guide-title">
      <div className="login-guide-modal">
        <div className="login-guide-head">
          <div>
            <span>처음 시작 가이드</span>
            <h2 id="login-guide-title">이렇게 풀면 돼요</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="가이드 닫기">X</button>
        </div>

        <div className="login-guide-steps">
          <GuideStep
            type="skill"
            title="1. 스킬을 고르기"
            body="위의 스킬트리에서 오늘 풀 단원을 확인해요. 처음이면 정수와 유리수 1번부터 시작해요."
          />
          <GuideStep
            type="solve"
            title="2. 문제를 풀기"
            body="문제를 읽고 답을 골라요. 풀이 버튼을 누르면 계산 노트와 답 버튼이 보여요."
          />
          <GuideStep
            type="helper"
            title="3. 막히면 도움 받기"
            body="개념 학습은 기본 제공이라 언제든 무료예요. 풀이 방향·힌트를 쓰면 받을 XP가 5%씩 줄어요."
          />
        </div>

        <label className="login-guide-check">
          <input
            type="checkbox"
            checked={suppressChecked}
            onChange={(event) => onSuppressChange(event.target.checked)}
          />
          <span>7일간 다시 띄우지 않음</span>
        </label>

        <button className="login-guide-start" type="button" onClick={onClose}>
          시작하기
        </button>
      </div>
    </div>
  );
}

function GuideStep({ type, title, body }) {
  return (
    <article className="login-guide-step">
      <GuidePicture type={type} />
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </article>
  );
}

function GuidePicture({ type }) {
  if (type === "skill") {
    return (
      <svg className="login-guide-picture" viewBox="0 0 160 100" role="img" aria-label="스킬트리 그림">
        <rect width="160" height="100" rx="8" fill="#0f172a" />
        <rect x="12" y="12" width="38" height="12" rx="3" fill="#22c55e" />
        <rect x="61" y="12" width="38" height="12" rx="3" fill="#6366f1" />
        <rect x="110" y="12" width="38" height="12" rx="3" fill="#f59e0b" />
        <rect x="12" y="34" width="38" height="12" rx="3" fill="#164e63" />
        <rect x="61" y="34" width="38" height="12" rx="3" fill="#312e81" />
        <rect x="110" y="34" width="38" height="12" rx="3" fill="#7c2d12" />
        <path d="M31 24v10M80 24v10M129 24v10" stroke="#e5e7eb" strokeWidth="2" strokeLinecap="round" />
        <circle cx="31" cy="70" r="14" fill="#14b8a6" />
        <path d="M24 70l5 5 9-11" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (type === "solve") {
    return (
      <svg className="login-guide-picture" viewBox="0 0 160 100" role="img" aria-label="문제 풀이 그림">
        <rect width="160" height="100" rx="8" fill="#f8fafc" />
        <rect x="12" y="12" width="136" height="30" rx="5" fill="#111827" />
        <text x="22" y="31" fill="#fff" fontSize="13" fontWeight="800">(-3)+2-(-2)=?</text>
        {[0, 1, 2, 3, 4].map((item) => (
          <rect key={item} x={12 + item * 28} y="54" width="22" height="22" rx="5" fill={item === 2 ? "#14b8a6" : "#e2e8f0"} />
        ))}
        <text x="73" y="70" fill="#fff" fontSize="10" fontWeight="900">3</text>
      </svg>
    );
  }

  return (
    <svg className="login-guide-picture" viewBox="0 0 160 100" role="img" aria-label="풀이 도우미 그림">
      <rect width="160" height="100" rx="8" fill="#eef2ff" />
      <rect x="12" y="12" width="64" height="24" rx="5" fill="#ffffff" />
      <rect x="84" y="12" width="64" height="24" rx="5" fill="#ffffff" />
      <rect x="12" y="44" width="64" height="24" rx="5" fill="#ffffff" />
      <rect x="84" y="44" width="64" height="24" rx="5" fill="#ffffff" />
      <circle cx="29" cy="24" r="7" fill="#6366f1" />
      <circle cx="101" cy="24" r="7" fill="#14b8a6" />
      <circle cx="29" cy="56" r="7" fill="#f59e0b" />
      <circle cx="101" cy="56" r="7" fill="#ec4899" />
      <path d="M28 83c24-12 52-12 82 0" stroke="#111827" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function ResizeHandle({ workspaceRef, onResize }) {
  function startResize(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();

    const move = (moveEvent) => {
      const raw = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      onResize(Math.min(74, Math.max(52, raw)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing-workspace");
    };

    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <button
      className="resize-handle"
      onDoubleClick={() => onResize(68)}
      onPointerDown={startResize}
      aria-label="노트와 가이드 폭 조절"
      title="드래그해서 좌우 폭 조절, 더블클릭 초기화"
    >
      <span />
    </button>
  );
}

function getFallbackProblems(skill) {
  return getProblemsForSkill(skill);
}

function LoginScreen({ onLogin }) {
  return (
    <main className="login-screen">
      <div className="login-art">
        <div className="login-panel">
          <div className="brand-mark large">
            <Trophy size={34} />
          </div>
          <h1>Study Math Arena</h1>
          <p>교과 흐름을 따라 스킬을 열고, 풀이 노트와 AI 튜터로 경쟁하는 수학 학습장.</p>
          <div className="role-grid">
            <button onClick={() => onLogin("student")}>
              <strong>학생</strong>
              <span>중1 과정부터 문제를 풀고 스킬, 랭킹, 마크를 획득합니다.</span>
            </button>
            <button onClick={() => onLogin("parents")}>
              <strong>학부모</strong>
              <span>가입한 자녀를 조회해서 추가하고 학습 활동을 모니터링합니다.</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function ManagerLoginScreen({ onLogin }) {
  return (
    <main className="login-screen">
      <div className="login-art">
        <div className="login-panel manager-login-panel">
          <div className="brand-mark large">
            <ShieldCheck size={34} />
          </div>
          <h1>관리자 페이지 접속</h1>
          <p className="manager-warning">관리자만 접속이 가능합니다.</p>
          <button className="google-button manager-google-button" onClick={onLogin}>
            <UserRound size={16} />
            Google 로그인
          </button>
        </div>
      </div>
    </main>
  );
}

function ManagerAccessDenied({ user, onLogout }) {
  return (
    <main className="login-screen">
      <div className="login-art">
        <div className="login-panel manager-login-panel">
          <div className="brand-mark large">
            <ShieldCheck size={34} />
          </div>
          <h1>관리자 페이지 접속</h1>
          <p className="manager-warning">관리자만 접속이 가능합니다.</p>
          <button className="google-button manager-google-button" onClick={onLogout || (() => signOut(auth))}>
            Google 로그인
          </button>
        </div>
      </div>
    </main>
  );
}

function OnboardingPage({ user, profile, initialRole, onComplete }) {
  const [role, setRole] = useState(initialRole || (profile.role === "parents" ? "parents" : "student"));
  const [grade, setGrade] = useState(profile.grade || "중1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await onComplete({ role, grade });
    } catch (submitError) {
      console.error(submitError);
      setError(`저장 실패: ${submitError.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="onboarding-panel">
        <div className="brand-mark large">
          <Gamepad2 size={34} />
        </div>
        <h1>역할 선택</h1>
        <p>{user.displayName || user.email} 계정으로 시작합니다.</p>
        <div className="role-grid">
          <button className={role === "student" ? "selected" : ""} onClick={() => setRole("student")}>
            <strong>학생</strong>
            <span>중1 과정부터 문제를 풀고 스킬, 랭킹, 마크를 획득합니다.</span>
          </button>
          <button className={role === "parents" ? "selected" : ""} onClick={() => setRole("parents")}>
            <strong>학부모</strong>
            <span>가입한 자녀를 조회해서 추가하고 학습 활동을 모니터링합니다.</span>
          </button>
        </div>
        {role === "student" && (
          <label className="grade-picker">
            <span>학년</span>
            <select value={grade} onChange={(event) => setGrade(event.target.value)}>
              {gradeOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <small>학년은 통계용입니다. 고1이어도 중1 문제부터 순서대로 풉니다.</small>
          </label>
        )}
        {error && <div className="onboarding-error">{error}</div>}
        <button className="onboarding-submit" onClick={submit} disabled={submitting}>
          {submitting ? "저장 중..." : "시작하기"}
        </button>
      </div>
    </main>
  );
}

const skillIcons = {
  "m1-numbers": "±",
  "m1-expressions": "x",
  "m1-equations": "=",
  "m1-coordinates": "↗",
  "m1-geometry-basic": "△",
  "m1-plane-solid": "◻",
  "m1-statistics": "≡",
  "m2-rational": "÷",
  "m2-polynomial": "x²",
  "m2-linear-system": "‖",
  "m2-inequality": "<",
  "m2-functions": "∕",
  "m2-geometry": "∠",
  "m2-similarity": "∼",
  "m2-probability": "P",
  "m3-real-roots": "√",
  "m3-polynomial": "×",
  "m3-quadratic": "²",
  "m3-quadratic-function": "∪",
  "m3-pythagorean": "c²",
  "m3-circle": "○",
  "m3-statistics": "σ",
  "h-common-polynomial": "∏",
  "h-common-equations": "≠",
  "h-common-functions": "f",
  "h-common-geometry": "□",
  "h-common-combinatorics": "C",
  "h-math1-exponential-log": "eˣ",
  "h-math1-trigonometry": "sin",
  "h-math1-sequence": "Σ",
  "h-math2-limits": "lim",
  "h-math2-differential": "∂",
  "h-math2-integral": "∫",
  "h-calculus-sequence-limit": "∞",
  "h-calculus-differential": "d/dx",
  "h-calculus-integral": "∬",
  "h-geometry-conic": "⊙",
  "h-geometry-vector": "→",
  "h-geometry-space": "⟨⟩",
  "h-probability-counting": "n!",
  "h-probability": "P(A)",
  "h-statistics": "μ",
};

function SkillTree({ skills, selectedSkillId, completedSkills, solvedBySkill, unlockedSkills, onSelect, mobileCollapsed = false, onMobileToggle, pcCollapsed = false, onPcToggle }) {
  const boardRef = useRef(null);
  const stageOrder = ["중1", "중2", "중3", "고1", "고2", "고3"];
  const groupedSkills = stageOrder.map((stage) => ({
    stage,
    skills: skills
      .filter((skill) => skill.stage === stage)
      .sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0) || (a.level ?? 0) - (b.level ?? 0)),
  }));
  const maxStageSkillCount = Math.max(...groupedSkills.map((group) => group.skills.length), 1);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;

    const updateSkillScale = () => {
      const styles = window.getComputedStyle(board);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const headerHeight = 22;
      const stageGap = 5;
      const availableHeight = board.clientHeight - paddingY - headerHeight - stageGap;
      const linkCount = Math.max(0, maxStageSkillCount - 1);
      const idealLinkHeight = linkCount ? Math.min(8, Math.max(1, Math.floor(availableHeight * 0.1 / linkCount))) : 0;
      const nodeHeight = Math.floor((availableHeight - idealLinkHeight * linkCount) / maxStageSkillCount);
      const compactHeight = Math.max(18, Math.min(37, nodeHeight));
      const compactRatio = (compactHeight - 18) / 19;

      board.style.setProperty("--skill-node-height", `${compactHeight}px`);
      board.style.setProperty("--skill-link-height", `${idealLinkHeight}px`);
      board.style.setProperty("--skill-node-font-size", `${0.48 + compactRatio * 0.3}rem`);
      board.style.setProperty("--skill-icon-font-size", `${0.66 + compactRatio * 0.4}rem`);
      board.classList.toggle("skill-board-compact", compactHeight < 32);
    };

    updateSkillScale();
    const observer = new ResizeObserver(updateSkillScale);
    observer.observe(board);
    return () => observer.disconnect();
  }, [maxStageSkillCount]);

  return (
    <section className={`skill-panel ${mobileCollapsed ? "mobile-collapsed" : ""} ${pcCollapsed ? "pc-collapsed" : ""}`}>
      <div className="section-title">
        <div className="section-title-label">
          <Award size={18} />
          <h2>스킬 트리</h2>
        </div>
        <button className="pc-skill-toggle" type="button" onClick={onPcToggle}>
          {pcCollapsed ? "펼치기" : "접기"}
        </button>
        <button className="mobile-skill-toggle" type="button" onClick={onMobileToggle}>
          {mobileCollapsed ? "펼치기" : "접기"}
        </button>
      </div>
      <div className="skill-board" ref={boardRef}>
        {groupedSkills.map((group) => {
          const stageClass = { "중1":"s-m1","중2":"s-m2","중3":"s-m3","고1":"s-h1","고2":"s-h2","고3":"s-h3" }[group.stage] || "";
          return (
          <div className={`skill-stage ${stageClass}`} key={group.stage}>
            <div className="skill-stage-header">{group.stage}</div>
            <div className="skill-stage-list">
              {group.skills.map((skill, idx) => {
                const completed = completedSkills.includes(skill.id);
                const unlocked = unlockedSkills.has(skill.id);
                const selected = selectedSkillId === skill.id;
                const pending = unlocked && !completed;
                const solvedCount = solvedBySkill[skill.id]?.length || 0;
                return (
                  <div className="skill-node-wrap" key={skill.id}>
                    {idx > 0 && <div className="skill-link" />}
                    <button
                      className={`skill-node ${selected ? "selected" : ""} ${completed ? "completed" : ""} ${pending ? "pending" : ""} ${!unlocked ? "locked" : ""}`}
                      disabled={!unlocked}
                      onClick={() => onSelect(skill.id)}
                      title={skill.title}
                    >
                      <span className="skill-icon">{skillIcons[skill.id] || "∘"}</span>
                      <strong>{skill.title}</strong>
                      {completed && !selected && <em className="done">완료</em>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function Leaderboard({ leaders, currentUid, profile, showMyStats = true, className = "" }) {
  const displayLeaders = buildActualLeaderboard(leaders, currentUid, profile);
  const myRank = displayLeaders.findIndex((l) => l.uid === currentUid) + 1;
  const myLeader = displayLeaders.find((l) => l.uid === currentUid) || profile;
  const xp = myLeader?.xp || 0;
  const solved = myLeader?.solvedCount || 0;
  const level = Math.floor(xp / 200) + 1;
  const xpPct = Math.min(100, Math.round((xp % 200) / 200 * 100));
  const visibleLeaders = displayLeaders.slice(0, 5);

  return (
    <section className={`leader-panel ${className}`}>
      <div className="section-title">
        <Crown size={18} />
        <h2>랭킹</h2>
      </div>

      {showMyStats && (
        <div className="my-stats-card">
          <div className="my-rank-card compact-rank">
            <span>현재 순위</span>
            <b>{myRank > 0 ? `#${myRank}` : "-"}</b>
          </div>
          <div className="xp-bar-wrap">
            <div className="xp-bar-track">
              <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
            </div>
            <small>Lv.{level} &nbsp;·&nbsp; {xp % 200} / 200 XP → Lv.{level + 1}</small>
          </div>
        </div>
      )}

      {showMyStats && <div className="leader-divider">전체 순위</div>}

      <ol className="leader-list">
        {visibleLeaders.length ? visibleLeaders.map((leader) => {
          const rankIndex = displayLeaders.findIndex((item) => item.uid === leader.uid);
          return (
          <li key={leader.uid} className={leader.uid === currentUid ? "me" : ""}>
            <span className="rank-num">{rankIndex < 3 ? <Medal size={14} /> : rankIndex + 1}</span>
            {leader.photoURL ? (
              <div className="leader-avatar">
                <img src={leader.photoURL} alt="" referrerPolicy="no-referrer" />
              </div>
            ) : (
              <div className="leader-avatar placeholder"><UserRound size={15} /></div>
            )}
            <div>
              <strong>{formatStudentName(leader)}</strong>
            </div>
            <b>{leader.xp || 0} XP</b>
          </li>
          );
        }) : <li className="empty-row">아직 랭킹 데이터가 없습니다.</li>}
      </ol>
    </section>
  );
}

function buildActualLeaderboard(leaders, currentUid, profile) {
  const merged = new Map();
  for (const leader of leaders) {
    if (!leader?.uid) continue;
    merged.set(leader.uid, leader);
  }
  if (currentUid) {
    const currentLeader = merged.get(currentUid);
    merged.set(currentUid, { ...profile, ...currentLeader, uid: currentUid });
  }
  return Array.from(merged.values())
    .filter((leader) => (leader.role || "student") === "student" || leader.uid === currentUid)
    .sort((a, b) => (b.xp || 0) - (a.xp || 0));
}

function formatStudentName(member) {
  const name = maskName(member?.displayName) || "러너";
  return member?.grade ? `${name} (${member.grade})` : name;
}

function formatChildName(member) {
  const name = member?.displayName || "자녀";
  return member?.grade ? `자녀(${name}) · ${member.grade}` : `자녀(${name})`;
}

function formatAdminMemberName(member, members) {
  const role = member?.role || "student";
  const name = member?.displayName || member?.email || "이름 없음";
  if (role === "student") return `학생(${name})`;
  if (role === "parents") return `학부모(${name})`;
  if (role === "admin") return `관리자(${name})`;
  return `${role}(${name})`;
}

function maskEmail(email) {
  if (!email) return "이메일 없음";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  const masked = visible + "*".repeat(Math.max(local.length - 2, 1)) + "@" + domain;
  return masked;
}

function maskName(name) {
  if (!name) return "러너";
  const chars = [...name];
  if (chars.length <= 1) return name;
  if (chars.length === 2) return chars[0] + "*";
  return chars[0] + "*" + chars[chars.length - 1];
}

function MemberManager({ members, onRoleUpdate }) {
  const students = members.filter((member) => member.role === "student");

  async function saveMember(member, patch) {
    await onRoleUpdate({
      uid: member.uid,
      role: patch.role ?? member.role ?? "student",
      parentOf: patch.parentOf ?? member.parentOf ?? [],
      displayName: patch.displayName,
      grade: patch.grade,
      xp: patch.xp,
      solvedCount: patch.solvedCount,
      resetProgress: patch.resetProgress,
    });
  }

  async function handleRoleChange(member, role) {
    await saveMember(member, {
      role,
      parentOf: role === "parents" ? member.parentOf || [] : [],
    });
  }

  return (
    <div className="member-manager">
      <h3>회원 관리</h3>
      {members.length ? (
        <div className="member-table-wrap">
          <table className="member-table">
            <thead>
              <tr>
                <th>회원</th>
                <th>이름</th>
                <th>학년</th>
                <th>XP</th>
                <th>해결</th>
                <th>초기화</th>
                <th>권한</th>
                <th>자녀</th>
              </tr>
            </thead>
            <tbody>
              {members.slice(0, 80).map((member) => (
                <tr key={member.uid}>
                  <td data-label="회원">
                    <strong>{formatAdminMemberName(member, members)}</strong>
                    <small>{member.email}</small>
                  </td>
                  <td data-label="이름">
                    <input
                      defaultValue={member.displayName || ""}
                      onBlur={(event) => saveMember(member, { displayName: event.target.value })}
                      aria-label="학생 이름"
                    />
                  </td>
                  <td data-label="학년">
                    <input
                      defaultValue={member.grade || ""}
                      onBlur={(event) => saveMember(member, { grade: event.target.value })}
                      aria-label="학년"
                      placeholder="학년"
                    />
                  </td>
                  <td data-label="XP">
                    <input
                      type="number"
                      min="0"
                      defaultValue={member.xp || 0}
                      onBlur={(event) => saveMember(member, { xp: event.target.value })}
                      aria-label="XP"
                    />
                  </td>
                  <td data-label="해결">
                    <input
                      type="number"
                      min="0"
                      defaultValue={member.solvedCount || 0}
                      onBlur={(event) => saveMember(member, { solvedCount: event.target.value })}
                      aria-label="해결 수"
                    />
                  </td>
                  <td data-label="초기화">
                    <button
                      className="member-reset-button"
                      onClick={async () => {
                        if (!window.confirm(`${member.displayName || member.email} 의 XP와 풀이 기록을 모두 초기화합니까?`)) return;
                        await saveMember(member, { xp: 0, solvedCount: 0, resetProgress: true });
                      }}
                    >초기화</button>
                  </td>
                  <td data-label="권한">
                    <select value={member.role || "student"} onChange={(event) => handleRoleChange(member, event.target.value)}>
                      <option value="student">student</option>
                      <option value="parents">parents</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td data-label="자녀">
                    {(member.role || "student") === "parents" ? (
                      <div className="member-child-list">
                        {(member.parentOf || []).length ? (
                          (member.parentOf || []).map((childUid) => {
                            const child = students.find((student) => student.uid === childUid);
                            return <span key={childUid}>{child ? formatStudentName(child) : childUid}</span>;
                          })
                        ) : (
                          <span className="muted">연결 없음</span>
                        )}
                      </div>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>아직 등록된 회원이 없습니다. admin 계정으로 로그인하면 목업 학생 5명이 자동 생성됩니다.</p>
      )}
    </div>
  );
}

function AdminProblemManager({ onSaveProblem }) {
  const [query, setQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState("m1-numbers");
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadProblems() {
      setLoading(true);
      try {
        const baseProblems = skillFilter
          ? generatedProblems.filter((problem) => problem.nodeId === skillFilter)
          : generatedProblems;
        const dbItems = skillFilter ? await loadProblemsBySkill(skillFilter) : await loadAllProblems();
        if (cancelled) return;
        const dbProblems = new Map(dbItems.map((problem) => [problem.id, problem]));
        setProblems(baseProblems.map((problem) => ({ ...problem, ...(dbProblems.get(problem.id) || {}) })));
        setError("");
      } catch (loadError) {
        if (cancelled) return;
        console.error(loadError);
        setProblems(skillFilter ? generatedProblems.filter((problem) => problem.nodeId === skillFilter) : generatedProblems);
        setError(`문제 DB 조회 실패: ${loadError.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadProblems();
    return () => {
      cancelled = true;
    };
  }, [skillFilter]);

  const normalizedQuery = query.trim().toLowerCase();
  const rows = problems
    .map((problem) => ({ ...problem, ...(drafts[problem.id] || {}) }))
    .filter((problem) => !skillFilter || problem.nodeId === skillFilter)
    .filter((problem) => {
      if (!normalizedQuery) return true;
      return [
        problem.id,
        problem.title,
        problem.prompt,
        problem.answer,
        problem.hint,
        problem.nextStep,
        problem.conceptGuide,
        getSkillTitle(problem.nodeId),
      ].join(" ").toLowerCase().includes(normalizedQuery);
    });
  const visibleRows = rows.slice(0, 50);
  const qualityIssues = analyzeProblemQuality(rows);

  function updateDraft(problemId, patch) {
    setDrafts((current) => ({
      ...current,
      [problemId]: { ...(current[problemId] || {}), ...patch },
    }));
  }

  async function save(problem) {
    setSavingId(problem.id);
    try {
      await onSaveProblem(problem);
      setProblems((current) => current.map((item) => (item.id === problem.id ? { ...item, ...problem } : item)));
      setDrafts((current) => {
        const next = { ...current };
        delete next[problem.id];
        return next;
      });
    } finally {
      setSavingId("");
    }
  }

  return (
    <section className="admin-dashboard">
      <div className="admin-dashboard-head">
        <div className="section-title">
          <BookOpen size={18} />
          <h2>문제 관리</h2>
        </div>
        <div className="admin-dashboard-actions problem-admin-actions">
          <select value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} aria-label="단원 필터">
            <option value="">전체 단원</option>
            {curriculumNodes.map((node) => (
              <option value={node.id} key={node.id}>
                {node.stage} · {node.title}
              </option>
            ))}
          </select>
          <div className="admin-search-box">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="문제, 정답, 힌트 검색" />
          </div>
        </div>
      </div>
      {error && <div className="warning-bar">{error}</div>}
      <div className="admin-summary-grid">
        <StatCard label="전체 문제" value={`${problems.length.toLocaleString()}개`} />
        <StatCard label="조회 결과" value={`${rows.length.toLocaleString()}개`} />
        <StatCard label="화면 표시" value={`${visibleRows.length.toLocaleString()}개`} />
        <StatCard label="품질 점검" value={qualityIssues.length ? `${qualityIssues.length}건` : "정상"} />
      </div>
      <div className={`problem-quality-panel ${qualityIssues.length ? "has-issues" : ""}`}>
        <strong>문제 품질 체크</strong>
        {qualityIssues.length ? (
          <div className="problem-quality-list">
            {qualityIssues.slice(0, 8).map((issue) => (
              <button
                type="button"
                key={`${issue.problem.id}-${issue.type}`}
                onClick={() => {
                  setSkillFilter(issue.problem.nodeId);
                  setQuery(issue.problem.id);
                }}
              >
                <span>{issue.type}</span>
                <b>{getSkillTitle(issue.problem.nodeId)}</b>
                <em>{issue.message}</em>
              </button>
            ))}
          </div>
        ) : (
          <p>정답 누락, 객관식 정답 불일치, 긴 문항 문제가 없습니다.</p>
        )}
      </div>
      {rows.length > visibleRows.length && <p className="problem-admin-note">브라우저 성능을 위해 상위 50개만 표시합니다. 단원 필터나 검색으로 좁혀서 수정하세요.</p>}
      <div className="activity-table-wrap problem-admin-table-wrap">
        <table className="activity-table admin-activity-table problem-admin-table">
          <thead>
            <tr>
              <th className="col-category">단원</th>
              <th className="col-problem-no">번호</th>
              <th className="col-difficulty">난이도</th>
              <th className="col-problem">문제</th>
              <th className="col-answer">정답</th>
              <th className="col-problem">힌트</th>
              <th className="col-problem">풀이 방향</th>
              <th className="col-problem">개념 학습</th>
              <th className="col-status">저장</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((problem) => {
              const dirty = !!drafts[problem.id];
              return (
                <tr key={problem.id}>
                  <td className="col-category" data-label="단원">{getSkillTitle(problem.nodeId)}</td>
                  <td className="col-problem-no" data-label="번호">{problem.title?.replace(/\D+/g, "") || problem.id.split("-").pop()}</td>
                  <td className="col-difficulty" data-label="난이도">
                    <input
                      className="problem-cell-input small"
                      type="number"
                      min="1"
                      max="5"
                      value={problem.difficulty || 1}
                      onChange={(event) => updateDraft(problem.id, { difficulty: event.target.value })}
                    />
                  </td>
                  <td className="col-problem" data-label="문제">
                    <textarea
                      className="problem-cell-input"
                      value={problem.prompt || ""}
                      onChange={(event) => updateDraft(problem.id, { prompt: event.target.value })}
                    />
                  </td>
                  <td className="col-answer" data-label="정답">
                    <input
                      className="problem-cell-input answer"
                      value={problem.answer || ""}
                      onChange={(event) => updateDraft(problem.id, { answer: event.target.value })}
                    />
                  </td>
                  <td className="col-problem" data-label="힌트">
                    <textarea
                      className="problem-cell-input"
                      value={problem.hint || ""}
                      onChange={(event) => updateDraft(problem.id, { hint: event.target.value })}
                    />
                  </td>
                  <td className="col-problem" data-label="풀이 방향">
                    <textarea
                      className="problem-cell-input"
                      value={problem.nextStep || ""}
                      onChange={(event) => updateDraft(problem.id, { nextStep: event.target.value })}
                    />
                  </td>
                  <td className="col-problem" data-label="개념 학습">
                    <textarea
                      className="problem-cell-input"
                      value={problem.conceptGuide || ""}
                      onChange={(event) => updateDraft(problem.id, { conceptGuide: event.target.value })}
                    />
                  </td>
                  <td className="col-status" data-label="저장">
                    <button
                      className="problem-save-button"
                      disabled={!dirty || savingId === problem.id}
                      onClick={() => save(problem)}
                    >
                      {savingId === problem.id ? "저장 중" : "저장"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>조회된 문제가 없습니다.</p>}
    </section>
  );
}

function AdminLearningDashboard({ members, attempts }) {
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const students = members.filter((member) => member.role === "student");
  const selectedStudent = students.find((student) => student.uid === selectedStudentId);
  const scopedStudents = selectedStudent ? [selectedStudent] : students;
  const displayAttempts = buildFallbackAttemptsForChildren(scopedStudents, attempts);
  const scopedAttempts = selectedStudent ? displayAttempts.filter((attempt) => attempt.uid === selectedStudent.uid) : displayAttempts;
  const completedAttempts = scopedAttempts.filter((attempt) => attempt.completed);
  const wrongAttempts = scopedAttempts.filter((attempt) => attempt.status === "wrong" || attempt.wrong);
  const helpedAttempts = scopedAttempts.filter((attempt) => getHelpUsed(attempt).length);
  const totalSolved = scopedStudents.reduce((sum, student) => sum + (Number(student.solvedCount) || 0), 0);
  const avgSolved = scopedStudents.length ? Math.round(totalSolved / scopedStudents.length) : 0;
  const accuracy = completedAttempts.length + wrongAttempts.length
    ? Math.round((completedAttempts.length / (completedAttempts.length + wrongAttempts.length)) * 100)
    : 0;

  const skillStatus = buildSkillStatusChart(completedAttempts, scopedStudents);
  const skillSolved = buildTopSkillMetricChart(completedAttempts, undefined, 5);
  const skillWrong = buildTopSkillMetricChart(wrongAttempts, undefined, 5);
  const skillHelp = buildTopSkillMetricChart(helpedAttempts, (attempt) => getHelpUsed(attempt).length, 5);
  const recentTrend = buildRecentTrendChart(scopedAttempts);
  const parentEmails = selectedStudent ? getParentEmailsForStudent(selectedStudent.uid, members) : [];
  const reportSubject = selectedStudent ? `[Study Math Arena] ${selectedStudent.displayName || "학생"} 학습 리포트` : "[Study Math Arena] 전체 학습 리포트";
  const reportBody = buildLearningReportText({
    student: selectedStudent,
    totalSolved,
    avgSolved,
    accuracy,
    skillStatus,
    skillSolved,
    skillWrong,
    skillHelp,
  });

  return (
    <section className="admin-dashboard">
      <div className="admin-dashboard-head">
        <div className="section-title">
          <TrendingUp size={18} />
          <h2>학습 통계</h2>
        </div>
        <div className="admin-dashboard-actions learning-report-actions">
          <select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)} aria-label="학생 조회">
            <option value="">전체 학생</option>
            {students.map((student) => (
              <option value={student.uid} key={student.uid}>
                {student.displayName || student.email}
              </option>
            ))}
          </select>
          <button onClick={() => window.print()}>
            <Printer size={14} />
            리포트 출력
          </button>
          <a
            className={!selectedStudent || !parentEmails.length ? "disabled" : ""}
            href={selectedStudent && parentEmails.length ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(parentEmails.join(","))}&su=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!selectedStudent || !parentEmails.length}
          >
            <Mail size={14} />
            부모에게 발송
          </a>
        </div>
      </div>
      <div className="admin-summary-grid">
        <StatCard label={selectedStudent ? "조회 학생" : "전체 학생"} value={selectedStudent ? selectedStudent.displayName || "학생" : `${students.length}명`} />
        <StatCard label="해결 문제" value={`${totalSolved}개`} />
        <StatCard label="평균 해결" value={`${avgSolved}개`} />
        <StatCard label="정답률" value={`${accuracy}%`} />
      </div>
      <div className="admin-chart-grid learning-chart-grid">
        <DonutChartCard title="전체 스킬 완료 현황" items={skillStatus} centerLabel="완료" />
        <DonutChartCard title="스킬별 해결 수" items={skillSolved} centerLabel="해결" />
        <DonutChartCard title="스킬별 오답 수" items={skillWrong} centerLabel="오답" />
        <DonutChartCard title="스킬별 도움 사용량" items={skillHelp} centerLabel="도움" />
      </div>
      <div className="admin-wide-chart">
        <ColumnChartCard title="최근 7일 학습 흐름" items={recentTrend} />
      </div>
      <LearningPrintReports students={scopedStudents} attempts={displayAttempts} allStudents={students} />
    </section>
  );
}

function LearningPrintReports({ students, attempts, allStudents }) {
  const rankedStudents = [...allStudents].sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const maxXp = rankedStudents.length ? (Number(rankedStudents[0]?.xp) || 0) : 0;
  const avgXp = allStudents.length ? Math.round(allStudents.reduce((sum, s) => sum + (Number(s.xp) || 0), 0) / allStudents.length) : 0;
  const avgSolved = allStudents.length ? Math.round(allStudents.reduce((sum, s) => sum + (Number(s.solvedCount) || 0), 0) / allStudents.length) : 0;
  const dateLabel = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date());
  const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

  return createPortal(
    <div className="print-report-root" aria-hidden="true">
      {students.map((student) => {
        const studentAttempts = attempts.filter((a) => a.uid === student.uid);
        const completedAttempts = studentAttempts.filter((a) => a.completed);
        const wrongAttempts = studentAttempts.filter((a) => a.status === "wrong" || a.wrong);
        const totalAnswered = completedAttempts.length + wrongAttempts.length;
        const accuracyPct = totalAnswered ? Math.round((completedAttempts.length / totalAnswered) * 100) : 0;
        const accuracy = totalAnswered ? `${accuracyPct}%` : "-";
        const rankIndex = rankedStudents.findIndex((s) => s.uid === student.uid);
        const studentXp = Number(student.xp) || 0;
        const dashboard = buildChildDashboard({ child: student, attempts: studentAttempts, students: allStudents, rankIndex, avgXp, avgSolved });
        const recentRows = studentAttempts.slice(0, 6);

        const now = new Date();
        const weekDays = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now);
          d.setDate(now.getDate() - (6 - i));
          return {
            label: DAY_KO[d.getDay()],
            active: studentAttempts.some((a) => {
              const at = a.timestamp?.toDate ? a.timestamp.toDate() : a.timestamp ? new Date(a.timestamp) : null;
              return at && at.toDateString() === d.toDateString();
            }),
          };
        });

        return (
          <article className="print-student-report" key={student.uid}>
            <header className="print-report-head">
              <div className="print-head-brand">Study Math Arena</div>
              <div className="print-head-center">
                <h1>{student.displayName || student.email || "학생"} 학습 리포트</h1>
                <p>{student.grade || "학년 미설정"} · {student.email || "이메일 없음"}</p>
              </div>
              <div className="print-head-date">{dateLabel}</div>
            </header>

            <section className="print-metric-grid">
              <div className="print-metric pm-blue"><span>XP</span><strong>{studentXp.toLocaleString()}</strong><small>평균 {avgXp.toLocaleString()}</small></div>
              <div className="print-metric pm-green"><span>해결 문제</span><strong>{Number(student.solvedCount) || completedAttempts.length}개</strong><small>평균 {avgSolved}개</small></div>
              <div className="print-metric pm-orange"><span>정답률</span><strong>{accuracy}</strong></div>
              <div className="print-metric pm-purple"><span>전체 순위</span><strong>{dashboard.growth[2]?.value || (rankIndex >= 0 ? `${rankIndex + 1}위` : "-")}</strong></div>
            </section>

            <section className="print-charts-row">
              <div className="print-chart-box">
                <div className="print-chart-title">XP 비교</div>
                <PrintXpChart studentXp={studentXp} avgXp={avgXp} maxXp={maxXp} />
              </div>
              <div className="print-chart-box">
                <div className="print-chart-title">정답률</div>
                <PrintAccuracyGauge pct={accuracyPct} />
              </div>
              <div className="print-chart-box">
                <div className="print-chart-title">최근 7일 활동</div>
                <PrintWeekDots days={weekDays} />
              </div>
            </section>

            <div className="print-two-col">
              <section className="print-report-section">
                <h2>학습 요약</h2>
                <div className="print-info-grid">
                  {dashboard.summary.map((item) => <PrintMetric key={item.label} label={item.label} value={item.value} />)}
                </div>
              </section>
              <section className="print-report-section print-risks-section">
                <h2>위험 신호</h2>
                <div className="print-info-grid">
                  {dashboard.risks.map((item) => <PrintMetric key={item.label} label={item.label} value={item.value} detail={item.detail} />)}
                </div>
              </section>
            </div>

            <section className="print-report-section print-activity-section">
              <h2>최근 활동</h2>
              <table>
                <thead>
                  <tr><th>날짜</th><th>단원</th><th>문제</th><th>상태</th></tr>
                </thead>
                <tbody>
                  {recentRows.length ? recentRows.map((attempt) => {
                    const problemText = getProblemText(attempt);
                    return (
                      <tr key={attempt.id}>
                        <td>{formatAttemptDate(attempt)}</td>
                        <td>{problemText.category}</td>
                        <td>{problemText.prompt || attempt.problemId}</td>
                        <td>{getAttemptResult(attempt)}</td>
                      </tr>
                    );
                  }) : <tr><td colSpan="4">최근 활동 기록이 없습니다.</td></tr>}
                </tbody>
              </table>
            </section>
          </article>
        );
      })}
    </div>,
    document.body
  );
}

function PrintXpChart({ studentXp, avgXp, maxXp }) {
  const W = 160;
  const max = Math.max(maxXp, studentXp, 1);
  const sw = Math.round((studentXp / max) * W);
  const aw = Math.round((avgXp / max) * W);
  return (
    <svg width={W + 60} height={46} style={{ display: "block", overflow: "visible" }}>
      <text x={0} y={11} fontSize={8} fill="#475569" fontWeight="700">내 XP</text>
      <rect x={36} y={1} width={Math.max(sw, 2)} height={13} fill="#3b82f6" rx={2} />
      <text x={36 + Math.max(sw, 2) + 3} y={12} fontSize={8} fill="#1e40af" fontWeight="700">{studentXp.toLocaleString()}</text>
      <text x={0} y={33} fontSize={8} fill="#94a3b8" fontWeight="700">평균</text>
      <rect x={36} y={23} width={Math.max(aw, 2)} height={13} fill="#bfdbfe" rx={2} />
      <text x={36 + Math.max(aw, 2) + 3} y={34} fontSize={8} fill="#64748b">{avgXp.toLocaleString()}</text>
    </svg>
  );
}

function PrintAccuracyGauge({ pct }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={46} height={46} viewBox="0 0 46 46">
      <circle cx={23} cy={23} r={r} fill="none" stroke="#e2e8f0" strokeWidth={5} />
      <circle cx={23} cy={23} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${c}`} strokeDashoffset={c / 4} strokeLinecap="round" />
      <text x={23} y={27} textAnchor="middle" fontSize={9} fontWeight="800" fill="#0f172a">{pct}%</text>
    </svg>
  );
}

function PrintWeekDots({ days }) {
  return (
    <svg width={140} height={46} style={{ display: "block" }}>
      {days.map((day, i) => (
        <g key={i} transform={`translate(${i * 20}, 0)`}>
          <circle cx={8} cy={14} r={7} fill={day.active ? "#3b82f6" : "#e2e8f0"} />
          {day.active && <text x={8} y={18} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="800">✓</text>}
          <text x={8} y={34} textAnchor="middle" fontSize={8} fill={day.active ? "#1e40af" : "#94a3b8"} fontWeight={day.active ? "700" : "400"}>{day.label}</text>
        </g>
      ))}
    </svg>
  );
}

function PrintMetric({ label, value, detail = "" }) {
  return (
    <div className="print-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function AdminAuditLog({ members, auditLogs }) {
  const [query, setQuery] = useState("");
  const rows = (auditLogs || []).map((log) => {
    const member = members.find((item) => item.uid === log.uid);
    return {
      id: `audit-${log.id}`,
      date: formatLogDate(log),
      time: getLogTime(log),
      student: member ? formatAdminMemberName(member, members) : log.displayName || log.email || log.uid || "사용자",
      category: getAuditCategoryLabel(log),
      problem: log.message || getAuditActionLabel(log.action),
      answer: log.metadata?.submittedAnswer || "-",
      result: getAuditActionLabel(log.action),
      resultClass: log.category === "auth" ? "positive" : log.action === "problem_wrong" ? "negative" : "",
      help: formatAuditMetadata(log),
    };
  }).sort((a, b) => (b.time || 0) - (a.time || 0));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(normalizedQuery))
    : rows;

  return (
    <section className="admin-dashboard">
      <div className="admin-dashboard-head">
        <div className="section-title">
          <ScrollText size={18} />
          <h2>감사 로그</h2>
        </div>
        <div className="admin-search-box">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="학생, 문제, 결과 검색" />
        </div>
      </div>
      <div className="admin-records-panel audit-log-panel">
        <div className="activity-table-wrap">
          <table className="activity-table admin-activity-table">
            <thead>
              <tr>
                <th className="col-date">날짜</th>
                <th className="col-child">학생</th>
                <th className="col-category">구분</th>
                <th className="col-problem">문제</th>
                <th className="col-answer">입력 답</th>
                <th className="col-status">결과</th>
                <th className="col-help">사용한 도움</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="col-date">{row.date}</td>
                  <td className="col-child">{row.student}</td>
                  <td className="col-category">{row.category}</td>
                  <td className="col-problem">{row.problem}</td>
                  <td className="col-answer">{row.answer}</td>
                  <td className="col-status"><strong className={row.resultClass}>{row.result}</strong></td>
                  <td className="col-help">{row.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredRows.length && <p>검색 결과가 없습니다.</p>}
      </div>
    </section>
  );
}

function AdminAiUsage({ members, usageLogs }) {
  const [query, setQuery] = useState("");
  const rows = usageLogs.map((log) => {
    const member = members.find((item) => item.uid === log.uid);
    return {
      id: log.id,
      date: formatLogDate(log),
      student: member ? formatAdminMemberName(member, members) : log.uid || "학생",
      skill: getSkillTitle(log.nodeId),
      action: log.action || "AI 가이드",
      model: log.model || "-",
      inputTokens: Number(log.inputTokens) || 0,
      outputTokens: Number(log.outputTokens) || 0,
      totalTokens: Number(log.totalTokens) || 0,
    };
  });
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(normalizedQuery))
    : rows;
  const totals = rows.reduce(
    (sum, row) => ({
      requests: sum.requests + 1,
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      totalTokens: sum.totalTokens + row.totalTokens,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
  const byStudent = groupRowsForTokenChart(rows, (row) => row.student).slice(0, 5);
  const byAction = groupRowsForTokenChart(rows, (row) => row.action).slice(0, 5);

  return (
    <section className="admin-dashboard">
      <div className="admin-dashboard-head">
        <div className="section-title">
          <Wand2 size={18} />
          <h2>AI 사용량</h2>
        </div>
        <div className="admin-search-box">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="학생, 스킬, 모델 검색" />
        </div>
      </div>
      <div className="admin-summary-grid">
        <StatCard label="AI 요청" value={`${totals.requests}회`} />
        <StatCard label="입력 토큰" value={totals.inputTokens.toLocaleString()} />
        <StatCard label="출력 토큰" value={totals.outputTokens.toLocaleString()} />
        <StatCard label="전체 토큰" value={totals.totalTokens.toLocaleString()} />
      </div>
      <div className="admin-chart-grid compact">
        <DonutChartCard title="학생별 토큰 TOP 5" items={byStudent} centerLabel="토큰" />
        <DonutChartCard title="액션별 토큰 TOP 5" items={byAction} centerLabel="토큰" />
      </div>
      <div className="admin-records-panel audit-log-panel">
        <h3>AI 사용 로그</h3>
        <div className="activity-table-wrap">
          <table className="activity-table admin-activity-table">
            <thead>
              <tr>
                <th className="col-date">날짜</th>
                <th className="col-child">학생</th>
                <th className="col-category">스킬</th>
                <th className="col-status">액션</th>
                <th className="col-help">모델</th>
                <th className="col-answer">입력</th>
                <th className="col-answer">출력</th>
                <th className="col-answer">전체</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="col-date">{row.date}</td>
                  <td className="col-child">{row.student}</td>
                  <td className="col-category">{row.skill}</td>
                  <td className="col-status">{row.action}</td>
                  <td className="col-help">{row.model}</td>
                  <td className="col-answer">{row.inputTokens.toLocaleString()}</td>
                  <td className="col-answer">{row.outputTokens.toLocaleString()}</td>
                  <td className="col-answer"><strong>{row.totalTokens.toLocaleString()}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredRows.length && <p>AI 사용량 로그가 없습니다. 새 AI 점검부터 토큰 사용량이 저장됩니다.</p>}
      </div>
    </section>
  );
}

function groupRowsForTokenChart(rows, labelFn) {
  const grouped = new Map();
  for (const row of rows) {
    const label = labelFn(row) || "기타";
    grouped.set(label, (grouped.get(label) || 0) + row.totalTokens);
  }
  return Array.from(grouped, ([label, value]) => ({ label, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function formatLogDate(log) {
  const time = getLogTime(log);
  if (!time) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
}

function getLogTime(log) {
  if (typeof log.createdAtMs === "number") return log.createdAtMs;
  const source = log.createdAt;
  if (!source) return 0;
  if (typeof source.seconds === "number") return source.seconds * 1000;
  if (typeof source.toMillis === "function") return source.toMillis();
  if (source instanceof Date) return source.getTime();
  if (typeof source === "string") return new Date(source).getTime() || 0;
  if (typeof source === "number") return source;
  return 0;
}

function getAuditActionLabel(action) {
  const labels = {
    login: "로그인",
    logout: "로그아웃",
    manager_access_denied: "관리자 접근 거부",
    parent_view: "자녀 학습 조회",
    problem_wrong: "오답 제출",
    problem_completed: "해결 완료",
    ai_guide: "AI 가이드",
    exam_submitted: "시험 응시",
  };
  return labels[action] || action || "-";
}

function getAuditCategoryLabel(log) {
  const labels = {
    auth: "로그인/계정",
    parent: "학부모",
    learning: getSkillTitle(log.metadata?.nodeId) || "문제 풀이",
    ai: "AI 사용",
    exam: "시험",
    system: "시스템",
  };
  return labels[log.category] || log.category || "감사";
}

function formatAuditMetadata(log) {
  const metadata = log.metadata || {};
  if (log.action === "parent_view") return `자녀 ${metadata.parentOf?.length || 0}명`;
  if (log.action === "ai_guide") return metadata.totalTokens ? `${Number(metadata.totalTokens).toLocaleString()} 토큰` : "AI 사용";
  if (log.action === "exam_submitted") return metadata.score != null ? `${metadata.score}점` : "시험";
  if (log.category === "learning") return metadata.helpUsed?.length ? `${metadata.helpUsed.length}개 도움` : "-";
  if (log.category === "auth") return metadata.role || log.role || "-";
  return "-";
}

function getParentEmailsForStudent(studentUid, members) {
  return members
    .filter((member) => (member.role || "student") === "parents" && (member.parentOf || []).includes(studentUid))
    .map((member) => member.email)
    .filter(Boolean);
}

function buildLearningReportText({ student, totalSolved, avgSolved, accuracy, skillStatus, skillSolved, skillWrong, skillHelp }) {
  const target = student ? `${student.displayName || "학생"} (${student.grade || "학년 미설정"})` : "전체 학생";
  const lines = [
    `학습 리포트: ${target}`,
    "",
    `해결 문제: ${totalSolved}개`,
    `평균 해결: ${avgSolved}개`,
    `정답률: ${accuracy}%`,
    "",
    "[전체 스킬 완료 현황]",
    ...skillStatus.map((item) => `- ${item.label}: ${item.value}`),
    "",
    "[스킬별 해결 수 TOP 5]",
    ...(skillSolved.length ? skillSolved.map((item) => `- ${item.label}: ${item.value}`) : ["- 데이터 없음"]),
    "",
    "[스킬별 오답 수 TOP 5]",
    ...(skillWrong.length ? skillWrong.map((item) => `- ${item.label}: ${item.value}`) : ["- 데이터 없음"]),
    "",
    "[스킬별 도움 사용량 TOP 5]",
    ...(skillHelp.length ? skillHelp.map((item) => `- ${item.label}: ${item.value}`) : ["- 데이터 없음"]),
  ];
  return lines.join("\n");
}

function StatCard({ label, value }) {
  return (
    <div className="admin-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarChartCard({ title, items, tone, suffix = "" }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className={`admin-chart-card ${tone}`}>
      <h3>{title}</h3>
      {items.length ? (
        <div className="admin-bar-list">
          {items.map((item) => (
            <div className="admin-bar-row" key={item.label}>
              <span>{item.label}</span>
              <div className="admin-bar-track">
                <i style={{ width: `${Math.max(6, Math.round((item.value / max) * 100))}%` }} />
              </div>
              <b>{item.value}{suffix}</b>
            </div>
          ))}
        </div>
      ) : (
        <p>표시할 데이터가 없습니다.</p>
      )}
    </div>
  );
}

function DonutChartCard({ title, items, centerLabel }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0));
  const colors = ["#14b8a6", "#38bdf8", "#f59e0b", "#64748b", "#8b5cf6", "#ef4444", "#22c55e", "#94a3b8"];
  const centerValue = centerLabel === "완료" ? items[0]?.value || 0 : items.reduce((sum, item) => sum + item.value, 0);
  let current = 0;
  const gradient = items.map((item, index) => {
    const start = current;
    const end = current + (item.value / total) * 100;
    current = end;
    return `${colors[index % colors.length]} ${start}% ${end}%`;
  }).join(", ");

  return (
    <div className="admin-chart-card admin-donut-card">
      <h3>{title}</h3>
      {items.length ? (
        <div className="admin-donut-layout">
          <div className="admin-donut" style={{ background: `conic-gradient(${gradient})` }}>
            <div>
              <strong>{centerValue}</strong>
              <span>{centerLabel}</span>
            </div>
          </div>
          <div className="admin-donut-legend">
            {items.map((item, index) => (
              <div key={item.label}>
                <i style={{ background: colors[index % colors.length] }} />
                <span>{item.label}</span>
                <b>{item.value}</b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p>표시할 데이터가 없습니다.</p>
      )}
    </div>
  );
}

function RadarChartCard({ title, items, tone }) {
  const chartItems = items.length ? items.slice(0, 8) : [
    { label: "데이터 없음", value: 0 },
    { label: "기록 없음", value: 0 },
    { label: "미집계", value: 0 },
  ];
  const max = Math.max(1, ...chartItems.map((item) => item.value));
  const center = 82;
  const radius = 56;
  const colorMap = {
    teal: "#14b8a6",
    amber: "#f59e0b",
    slate: "#64748b",
  };
  const color = colorMap[tone] || "#14b8a6";
  const pointFor = (index, valueRadius) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / chartItems.length;
    return {
      x: center + Math.cos(angle) * valueRadius,
      y: center + Math.sin(angle) * valueRadius,
    };
  };
  const polygon = chartItems
    .map((item, index) => {
      const point = pointFor(index, radius * (item.value / max));
      return `${point.x},${point.y}`;
    })
    .join(" ");

  return (
    <div className={`admin-chart-card admin-radar-card ${tone}`}>
      <h3>{title}</h3>
      <div className="admin-radar-layout">
        <svg viewBox="0 0 164 164" role="img" aria-label={title}>
          {[0.33, 0.66, 1].map((scale) => (
            <polygon
              key={scale}
              className="radar-grid"
              points={chartItems.map((_, index) => {
                const point = pointFor(index, radius * scale);
                return `${point.x},${point.y}`;
              }).join(" ")}
            />
          ))}
          {chartItems.map((_, index) => {
            const point = pointFor(index, radius);
            return <line className="radar-axis" key={index} x1={center} y1={center} x2={point.x} y2={point.y} />;
          })}
          <polygon className="radar-area" points={polygon} style={{ fill: color, stroke: color }} />
          {chartItems.map((item, index) => {
            const point = pointFor(index, radius * (item.value / max));
            return <circle className="radar-point" key={item.label} cx={point.x} cy={point.y} r="2.8" style={{ fill: color }} />;
          })}
        </svg>
        <div className="admin-radar-legend">
          {chartItems.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <b>{item.value}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ColumnChartCard({ title, items }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="admin-chart-card admin-column-card">
      <h3>{title}</h3>
      <div className="admin-column-chart">
        {items.map((item) => (
          <div className="admin-column" key={item.label}>
            <div className="admin-column-track">
              <i style={{ height: `${Math.max(8, Math.round((item.value / max) * 100))}%` }} />
            </div>
            <b>{item.value}</b>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupAttemptsForChart(items, labelFn) {
  const grouped = new Map();
  for (const item of items) {
    const label = labelFn(item) || "기타";
    grouped.set(label, (grouped.get(label) || 0) + 1);
  }
  return Array.from(grouped, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function getSkillTitle(nodeId) {
  return curriculumNodes.find((node) => node.id === nodeId)?.title || nodeId || "기타";
}

function buildSkillStatusChart(completedAttempts, students) {
  const completedByStudentSkill = new Map();
  for (const attempt of completedAttempts) {
    const key = `${attempt.uid}-${attempt.nodeId}`;
    const current = completedByStudentSkill.get(key) || new Set();
    current.add(attempt.problemId);
    completedByStudentSkill.set(key, current);
  }

  let completed = 0;
  let inProgress = 0;

  for (const node of curriculumNodes) {
    const counts = students.map((student) => completedByStudentSkill.get(`${student.uid}-${node.id}`)?.size || 0);
    const requiredCount = getProblemCountForSkill(node.id);
    if (counts.some((count) => count >= requiredCount)) {
      completed += 1;
    } else if (counts.some((count) => count > 0)) {
      inProgress += 1;
    }
  }

  const locked = Math.max(0, curriculumNodes.length - completed - inProgress);
  return [
    { label: "완료 스킬", value: completed },
    { label: "진행 중 스킬", value: inProgress },
    { label: "미완료 스킬", value: locked },
  ];
}

function buildTopSkillMetricChart(attempts, weightFn = () => 1, limit = 5) {
  const grouped = new Map();
  for (const attempt of attempts) {
    grouped.set(attempt.nodeId, (grouped.get(attempt.nodeId) || 0) + weightFn(attempt));
  }
  return Array.from(grouped, ([nodeId, value]) => ({
    label: getSkillTitle(nodeId),
    value,
  }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function buildRecentTrendChart(attempts) {
  const datedAttempts = attempts.filter((attempt) => getAttemptTime(attempt));
  const now = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    const key = getLocalDateKey(date);
    const label = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
    const value = datedAttempts.filter((attempt) => {
      const time = getAttemptTime(attempt);
      return time && getLocalDateKey(new Date(time)) === key;
    }).length;
    return { label, value };
  });
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ParentInsightPanel({ profile, members, attempts, onRegisterChild, onReportOpen, reportDisabled = false }) {
  const [childQuery, setChildQuery] = useState("");
  const students = members
    .filter((member) => member.role === "student")
    .sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const childIds = new Set(profile?.parentOf || []);
  const children = students.filter((student) => childIds.has(student.uid));
  const displayAttempts = buildFallbackAttemptsForChildren(children, attempts);
  const candidates = students
    .filter((student) => !childIds.has(student.uid))
    .filter((student) => {
      const queryText = childQuery.trim().toLowerCase();
      if (queryText.length < 2) return false;
      return (student.email || "").toLowerCase().includes(queryText);
    })
    .slice(0, 6);
  const avgXp = students.length ? Math.round(students.reduce((sum, student) => sum + (student.xp || 0), 0) / students.length) : 0;
  const avgSolved = students.length
    ? Math.round(students.reduce((sum, student) => sum + (student.solvedCount || 0), 0) / students.length)
    : 0;
  const weeklySummary = buildParentWeeklySummary(children, displayAttempts);

  return (
    <div className="parent-insight">
      <div className="section-title">
        <Users size={18} />
        <h2>자녀 학습 현황</h2>
        {onReportOpen && (
          <button type="button" className="section-action-button" onClick={onReportOpen} disabled={reportDisabled}>
            <Printer size={14} />
            자녀 리포트 PDF
          </button>
        )}
      </div>

      {onRegisterChild && (
        <div className="child-register">
          <div className="child-search-wrap">
            <Search size={15} className="child-search-icon" />
            <input
              value={childQuery}
              onChange={(event) => setChildQuery(event.target.value)}
              placeholder="자녀 이메일 2자 이상 입력"
            />
          </div>
          {candidates.length > 0 && (
            <div className="child-candidates">
              {candidates.map((student) => (
                <button
                  key={student.uid}
                  onClick={() => {
                    onRegisterChild(student.uid);
                    setChildQuery("");
                  }}
                >
                  <div className="candidate-avatar"><UserRound size={14} /></div>
                  <span>{maskEmail(student.email)}</span>
                  {student.grade && <em>{student.grade}</em>}
                </button>
              ))}
            </div>
          )}
          {childQuery.trim().length >= 2 && !candidates.length && (
            <p className="child-empty">일치하는 학생이 없습니다.</p>
          )}
        </div>
      )}

      <div className="child-list">
        {children.length > 0 && (
          <div className="weekly-summary-card">
            <div className="section-title">
              <TrendingUp size={17} />
              <h2>이번 주 요약</h2>
            </div>
            <div className="weekly-summary-grid">
              <div><span>해결</span><strong>{weeklySummary.completed}문제</strong></div>
              <div><span>오답</span><strong>{weeklySummary.wrong}회</strong></div>
              <div><span>최근 학습</span><strong>{weeklySummary.lastStudyLabel}</strong></div>
            </div>
            <p>{weeklySummary.note}</p>
          </div>
        )}
        {children.length ? children.map((child) => {
          const rankIndex = students.findIndex((student) => student.uid === child.uid);
          const above = rankIndex > 0 ? students[rankIndex - 1] : null;
          const below = rankIndex >= 0 && rankIndex < students.length - 1 ? students[rankIndex + 1] : null;
          const rankLabel = rankIndex >= 0 ? `전체 ${students.length}명 중 ${rankIndex + 1}위` : "순위 계산 중";
          const xpDiff = (child.xp || 0) - avgXp;
          const solvedDiff = (child.solvedCount || 0) - avgSolved;
          const childAttempts = displayAttempts.filter((attempt) => attempt.uid === child.uid);
          const dashboard = buildChildDashboard({ child, attempts: childAttempts, students, rankIndex, avgXp, avgSolved });
          return (
            <div className="child-card" key={child.uid}>
              <div className="child-card-header">
                <div className="child-avatar"><UserRound size={18} /></div>
                <div className="child-name-block">
                  <strong>{formatChildName(child)}</strong>
                  <span className="child-rank">{rankLabel}</span>
                </div>
                <div className="child-position">
                  <strong>{Number(child.xp || 0).toLocaleString()} XP</strong>
                  <small>DB 기준</small>
                </div>
              </div>
              <div className="child-stats">
                <div className="child-stat">
                  <label>XP</label>
                  <span>{Number(child.xp || 0).toLocaleString()}</span>
                </div>
                <div className="child-stat">
                  <label>문제 해결</label>
                  <span>{child.solvedCount || 0}</span>
                </div>
                <div className={`child-stat ${xpDiff >= 0 ? "positive" : "negative"}`}>
                  <label>평균 XP 대비</label>
                  <span>{formatSignedNumber(xpDiff)}</span>
                </div>
                <div className={`child-stat ${solvedDiff >= 0 ? "positive" : "negative"}`}>
                  <label>평균 해결 수 대비</label>
                  <span>{formatSignedNumber(solvedDiff)}</span>
                </div>
              </div>
              <ChildDashboard dashboard={dashboard} />
              {above && (
                <div className="child-gap">
                  <TrendingUp size={13} />
                  위 학생까지 {Math.max(0, (above.xp || 0) - (child.xp || 0))} XP
                </div>
              )}
              {!above && <div className="child-gap top">🏆 현재 1위</div>}
            </div>
          );
        }) : (
          <div className="child-empty-state">
            <Users size={32} />
            <p>위 검색창에서 자녀를 추가하면<br />학습 통계가 여기에 표시됩니다.</p>
          </div>
        )}
      </div>

      {children.length > 0 && (
        <div className="child-activity-section">
          <div className="section-title" style={{ marginTop: "16px" }}>
            <BookOpen size={18} />
            <h2>자녀 학습 기록</h2>
          </div>
          <ChildActivityLog children={children} attempts={displayAttempts} />
        </div>
      )}
    </div>
  );
}

function ChildDashboard({ dashboard }) {
  return (
    <div className="parent-dashboard">
      <div className="parent-dashboard-section">
        <h3>상단 요약</h3>
        <div className="parent-metric-grid">
          {dashboard.summary.map((item) => (
            <div className="parent-metric" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="parent-dashboard-section">
        <h3>위험 신호</h3>
        <div className="parent-signal-grid">
          {dashboard.risks.map((item) => (
            <div className={`parent-signal ${item.alert ? "alert" : ""}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.detail && <small>{item.detail}</small>}
            </div>
          ))}
        </div>
      </div>
      <div className="parent-dashboard-section">
        <h3>비교/성장</h3>
        <div className="parent-signal-grid">
          {dashboard.growth.map((item) => (
            <div className="parent-signal" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.detail && <small>{item.detail}</small>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildChildDashboard({ child, attempts, students, rankIndex, avgXp, avgSolved }) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  const recent = attempts.filter((attempt) => now - getAttemptTime(attempt) <= sevenDays);
  const previous = attempts.filter((attempt) => {
    const time = getAttemptTime(attempt);
    return now - time > sevenDays && now - time <= fourteenDays;
  });
  const completedRecent = recent.filter((attempt) => attempt.completed).length;
  const completedPrevious = previous.filter((attempt) => attempt.completed).length;
  const checkedRecent = recent.filter((attempt) => attempt.completed || attempt.status === "wrong" || attempt.wrong);
  const correctRecent = checkedRecent.filter((attempt) => attempt.completed).length;
  const accuracy = checkedRecent.length ? `${Math.round((correctRecent / checkedRecent.length) * 100)}%` : "-";
  const latest = attempts[0];
  const latestText = latest ? getProblemText(latest) : null;
  const overallTotal = curriculumNodes.length * 50;
  const completeRate = overallTotal ? `${Math.min(100, Math.round(((child.solvedCount || 0) / overallTotal) * 100))}%` : "-";
  const repeatedWrong = getTopGrouped(
    attempts.filter((attempt) => attempt.status === "wrong" || attempt.wrong),
    (attempt) => attempt.problemId,
    (attempt) => getProblemText(attempt).prompt || attempt.problemId,
  );
  const heavyHelp = getTopGrouped(
    attempts.filter((attempt) => getHelpUsed(attempt).length),
    (attempt) => getProblemText(attempt).category,
    (attempt) => getProblemText(attempt).category,
    (attempt) => getHelpUsed(attempt).length,
  );
  const lastTime = latest ? getAttemptTime(latest) : 0;
  const staleDays = lastTime ? Math.floor((now - lastTime) / (24 * 60 * 60 * 1000)) : null;
  const sameGrade = students.filter((student) => student.grade === child.grade);
  const gradeAvgSolved = sameGrade.length ? Math.round(sameGrade.reduce((sum, student) => sum + (student.solvedCount || 0), 0) / sameGrade.length) : avgSolved;
  const rankText = rankIndex >= 0 ? `전체 ${rankIndex + 1}위` : "-";

  return {
    summary: [
      { label: "현재 진행 단원", value: latestText?.category || "기록 없음" },
      { label: "전체 완료율", value: completeRate },
      { label: "최근 7일 해결", value: `${completedRecent}문제` },
      { label: "최근 7일 정답률", value: accuracy },
    ],
    risks: [
      { label: "반복 오답 문제", value: repeatedWrong ? `${repeatedWrong.label}` : "없음", detail: repeatedWrong ? `${repeatedWrong.count}회` : "", alert: !!repeatedWrong },
      { label: "힌트 많이 쓴 단원", value: heavyHelp ? heavyHelp.label : "없음", detail: heavyHelp ? `${heavyHelp.count}회` : "", alert: !!heavyHelp },
      { label: "오래 멈춘 단원", value: staleDays == null ? "기록 없음" : staleDays >= 7 ? latestText?.category || "확인 필요" : "없음", detail: staleDays == null ? "" : `${staleDays}일 전`, alert: staleDays >= 7 },
    ],
    growth: [
      { label: "같은 학년 평균 대비", value: formatSignedNumber((child.solvedCount || 0) - gradeAvgSolved), detail: "해결 문제 수" },
      { label: "지난주 대비", value: formatSignedNumber(completedRecent - completedPrevious), detail: "최근 7일 해결 수" },
      { label: "랭킹 변화", value: rankText, detail: "현재 기준" },
    ],
  };
}

function getTopGrouped(items, keyFn, labelFn, weightFn = () => 1) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const current = grouped.get(key) || { label: labelFn(item), count: 0 };
    current.count += weightFn(item);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((a, b) => b.count - a.count)[0] || null;
}

function mergeAttemptsWithProgress(attempts, progressDocs) {
  const existing = new Set(attempts.map((attempt) => `${attempt.uid}-${attempt.nodeId}-${attempt.problemId}`));
  const restored = [];
  for (const progress of progressDocs || []) {
    const solvedIds = Array.isArray(progress.solvedProblemIds) ? progress.solvedProblemIds : [];
    for (const problemId of solvedIds) {
      const key = `${progress.uid}-${progress.nodeId}-${problemId}`;
      if (existing.has(key)) continue;
      const problem = problemLookup.get(problemId);
      restored.push({
        id: `progress-${key}`,
        uid: progress.uid,
        nodeId: progress.nodeId,
        problemId,
        problemTitle: problem?.title || problemId,
        problemPrompt: problem?.prompt || "",
        submittedAnswer: "",
        helpUsed: [],
        status: "completed",
        completed: true,
        restoredFromProgress: true,
        createdAt: progress.updatedAt || null,
        completedAt: progress.updatedAt || null,
      });
    }
  }
  return [...attempts, ...restored].sort((a, b) => {
    const timeDiff = getAttemptTime(b) - getAttemptTime(a);
    if (timeDiff) return timeDiff;
    return String(b.problemId || "").localeCompare(String(a.problemId || ""));
  });
}

function buildFallbackAttemptsForChildren(children, attempts) {
  const result = [...attempts];
  const existing = new Set(result.map((attempt) => `${attempt.uid}-${attempt.nodeId}-${attempt.problemId}`));
  for (const child of children) {
    const solvedTarget = Number(child.solvedCount) || 0;
    if (!solvedTarget) continue;
    const currentSolved = new Set(
      result
        .filter((attempt) => attempt.uid === child.uid && attempt.completed)
        .map((attempt) => `${attempt.nodeId}-${attempt.problemId}`),
    );
    const missingCount = Math.max(0, solvedTarget - currentSolved.size);
    if (!missingCount) continue;
    const orderedProblems = generatedProblems.filter((problem) => !currentSolved.has(`${problem.nodeId}-${problem.id}`));
    const fallbackTime = child.lastSolvedAt || child.lastActivityAt || child.updatedAt || child.lastSeenAt || child.createdAt || null;
    orderedProblems.slice(0, missingCount).forEach((problem, index) => {
      const key = `${child.uid}-${problem.nodeId}-${problem.id}`;
      if (existing.has(key)) return;
      existing.add(key);
      result.push({
        id: `profile-solved-${key}`,
        uid: child.uid,
        nodeId: problem.nodeId,
        problemId: problem.id,
        problemTitle: problem.title,
        problemPrompt: problem.prompt,
        submittedAnswer: "",
        helpUsed: [],
        status: "completed",
        completed: true,
        restoredFromProfile: true,
        createdAt: fallbackTime,
        completedAt: fallbackTime,
        sortIndex: index,
      });
    });
  }
  return result.sort((a, b) => {
    const timeDiff = getAttemptTime(b) - getAttemptTime(a);
    if (timeDiff) return timeDiff;
    if (a.restoredFromProfile && b.restoredFromProfile) return (a.sortIndex || 0) - (b.sortIndex || 0);
    return String(b.problemId || "").localeCompare(String(a.problemId || ""));
  });
}

function buildWrongNotebookItems(attempts, solvedBySkill = {}) {
  const solvedKeys = new Set();
  for (const [nodeId, problemIds] of Object.entries(solvedBySkill || {})) {
    for (const problemId of problemIds || []) solvedKeys.add(`${nodeId}-${problemId}`);
  }
  attempts
    .filter((attempt) => attempt.completed)
    .forEach((attempt) => solvedKeys.add(`${attempt.nodeId}-${attempt.problemId}`));

  const grouped = new Map();
  attempts
    .filter((attempt) => attempt.status === "wrong" || attempt.wrong)
    .forEach((attempt) => {
      const key = `${attempt.nodeId}-${attempt.problemId}`;
      if (solvedKeys.has(key)) return;
      const current = grouped.get(key) || {
        nodeId: attempt.nodeId,
        problemId: attempt.problemId,
        ...getProblemText(attempt),
        count: 0,
        latestTime: 0,
      };
      grouped.set(key, {
        ...current,
        count: current.count + 1,
        latestTime: Math.max(current.latestTime, getAttemptTime(attempt) || 0),
      });
    });
  return Array.from(grouped.values()).sort((a, b) => b.latestTime - a.latestTime || b.count - a.count);
}

function buildParentWeeklySummary(children, attempts) {
  const childIds = new Set(children.map((child) => child.uid));
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekly = attempts.filter((attempt) => childIds.has(attempt.uid) && (getAttemptTime(attempt) || 0) >= weekAgo);
  const completed = weekly.filter((attempt) => attempt.completed).length;
  const wrong = weekly.filter((attempt) => attempt.status === "wrong" || attempt.wrong).length;
  const lastTime = Math.max(0, ...attempts.filter((attempt) => childIds.has(attempt.uid)).map(getAttemptTime));
  const lastStudyLabel = lastTime ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(new Date(lastTime)) : "-";
  const topWrong = buildTopSkillMetricChart(weekly.filter((attempt) => attempt.status === "wrong" || attempt.wrong), undefined, 1)[0];
  const note = topWrong
    ? `${topWrong.label}에서 오답이 가장 많이 나왔습니다.`
    : completed
      ? "이번 주 학습 기록이 안정적으로 쌓이고 있습니다."
      : "이번 주 학습 기록이 아직 없습니다.";
  return { completed, wrong, lastStudyLabel, note };
}

function analyzeProblemQuality(problems) {
  const issues = [];
  for (const problem of problems) {
    const prompt = String(problem.prompt || "").trim();
    const answer = String(problem.answer ?? "").trim();
    if (!prompt) issues.push({ type: "문제 누락", message: "문제 내용이 비어 있습니다.", problem });
    if (!answer) issues.push({ type: "정답 누락", message: "정답이 비어 있습니다.", problem });
    if (prompt.length > 180) issues.push({ type: "긴 문항", message: `문제가 ${prompt.length}자로 깁니다.`, problem });
    if (Array.isArray(problem.choices) && problem.choices.length) {
      const hasAnswer = problem.choices.some((choice) => normalizeMathAnswer(choice) === normalizeMathAnswer(answer));
      if (answer && !hasAnswer) issues.push({ type: "객관식", message: "정답이 보기 안에 없습니다.", problem });
    }
  }
  return issues;
}

function ChildActivityLog({ children, attempts }) {
  const childIds = new Set(children.map((c) => c.uid));
  const childName = new Map(children.map((c) => [c.uid, formatChildName(c)]));
  const showChildName = children.length > 1;
  const childAttempts = attempts.filter((a) => childIds.has(a.uid)).slice(0, 20);
  const wrongByChild = new Map();
  attempts
    .filter((a) => childIds.has(a.uid) && (a.status === "wrong" || a.wrong))
    .forEach((a) => {
      const key = `${a.uid}-${a.nodeId}-${a.problemId}`;
      const current = wrongByChild.get(key) || {
        uid: a.uid,
        nodeId: a.nodeId,
        problemId: a.problemId,
        ...getProblemText(a),
        submittedAnswer: getSubmittedAnswer(a),
        count: 0,
      };
      wrongByChild.set(key, { ...current, count: current.count + 1 });
    });
  const topWrong = Array.from(wrongByChild.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (!childAttempts.length && !topWrong.length) {
    return <p className="child-empty">자녀의 학습 기록이 아직 없습니다.</p>;
  }

  return (
    <div className="child-activity-log">
      {topWrong.length > 0 && (
        <>
          <p className="activity-subtitle">자주 틀리는 문제</p>
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  {showChildName && <th className="col-child">자녀</th>}
                  <th className="col-date">날짜</th>
                  <th className="col-category">구분</th>
                  <th className="col-problem">문제</th>
                  <th className="col-answer">입력 답</th>
                  <th className="col-status">결과</th>
                  <th className="col-help">사용한 도움</th>
                </tr>
              </thead>
              <tbody>
                {topWrong.map((item) => (
                  <tr key={`${item.uid}-${item.nodeId}-${item.problemId}`}>
                    {showChildName && <td className="col-child" data-label="자녀">{childName.get(item.uid) || "자녀"}</td>}
                    <td className="col-date" data-label="날짜">-</td>
                    <td className="col-category" data-label="구분">{item.category}</td>
                    <td className="col-problem" data-label="문제">{item.prompt || item.nodeId}</td>
                    <td className="col-answer" data-label="입력 답">{item.submittedAnswer || "기록 없음"}</td>
                    <td className="col-status" data-label="결과"><strong className="wrong-status">오답 {item.count}회</strong></td>
                    <td className="col-help" data-label="사용한 도움">-</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {childAttempts.length > 0 && (
        <>
          <p className="activity-subtitle">최근 활동</p>
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  {showChildName && <th className="col-child">자녀</th>}
                  <th className="col-date">날짜</th>
                  <th className="col-category">구분</th>
                  <th className="col-problem">문제</th>
                  <th className="col-answer">입력 답</th>
                  <th className="col-status">상태</th>
                  <th className="col-help">사용한 도움</th>
                </tr>
              </thead>
              <tbody>
                {childAttempts.map((a) => {
                  const problemText = getProblemText(a);
                  return (
                    <tr key={a.id}>
                      {showChildName && <td className="col-child" data-label="자녀">{childName.get(a.uid) || "자녀"}</td>}
                      <td className="col-date" data-label="날짜">{formatAttemptDate(a)}</td>
                      <td className="col-category" data-label="구분">{problemText.category}</td>
                      <td className="col-problem" data-label="문제">{problemText.prompt || `${a.nodeId} · ${a.problemId}`}</td>
                      <td className="col-answer" data-label="입력 답">{getSubmittedAnswer(a) || (a.restoredFromProgress || a.restoredFromProfile ? "기록 없음" : "-")}</td>
                      <td className="col-status" data-label="상태"><strong className={getAttemptResultClass(a)}>{getAttemptResult(a)}</strong></td>
                      <td className="col-help" data-label="사용한 도움">{a.restoredFromProgress || a.restoredFromProfile ? "완료 기록" : formatHelpUsed(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function formatSignedNumber(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function getProblemText(attempt) {
  const problem = problemLookup.get(attempt.problemId);
  const title = attempt.problemTitle || problem?.title || attempt.problemId;
  return {
    title,
    category: title.replace(/\s+\d+$/, ""),
    prompt: attempt.problemPrompt || problem?.prompt || "",
  };
}

function getAttemptTime(attempt) {
  const source = attempt.completedAt || attempt.createdAt;
  if (!source) return 0;
  if (typeof source.seconds === "number") return source.seconds * 1000;
  if (typeof source.toMillis === "function") return source.toMillis();
  if (source instanceof Date) return source.getTime();
  if (typeof source === "string") return new Date(source).getTime() || 0;
  if (typeof source === "number") return source;
  return 0;
}

function formatAttemptDate(attempt) {
  const time = getAttemptTime(attempt);
  if (!time) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
}

function getSubmittedAnswer(attempt) {
  return attempt.submittedAnswer || attempt.inputAnswer || attempt.answerInput || "";
}

function getHelpUsed(attempt) {
  return Array.isArray(attempt.helpUsed) ? attempt.helpUsed : [];
}

function formatHelpUsed(attempt) {
  const labelMap = {
    next: "풀이 방향",
    hint: "힌트",
    concept: "개념",
  };
  const labels = getHelpUsed(attempt).map((item) => labelMap[item] || item);
  return labels.length ? labels.join(", ") : "-";
}

function getAttemptResult(attempt) {
  if (attempt.completed) return "해결 완료";
  if (attempt.status === "wrong" || attempt.wrong) return "오답";
  if (attempt.saved || attempt.status === "saved") return "이전 기록";
  return attempt.status || "-";
}

function getAttemptResultClass(attempt) {
  if (attempt.completed) return "positive";
  if (attempt.status === "wrong" || attempt.wrong) return "wrong-status";
  return "";
}

function ActivityPanel({ members, attempts }) {
  const memberName = new Map(members.map((member) => [member.uid, member.displayName || member.email || "학생"]));
  const frequentWrong = getFrequentWrongProblems(attempts);
  return (
    <div className="activity-panel">
      <h3>자주 틀리는 문제</h3>
      {frequentWrong.length ? (
        <div className="wrong-list">
          {frequentWrong.map((item) => (
            <div className="wrong-row" key={`${item.nodeId}-${item.problemId}`}>
              <strong>{item.category}</strong>
              <span>{item.prompt || item.nodeId}</span>
              <b>{item.count}회</b>
            </div>
          ))}
        </div>
      ) : (
        <p>아직 오답 기록이 없습니다.</p>
      )}
      <h3>학습 기록</h3>
      {attempts.length ? (
        attempts.slice(0, 12).map((attempt) => (
          <div className="activity-row" key={attempt.id}>
            <strong>{memberName.get(attempt.uid) || "학생"} · {getProblemText(attempt).title}</strong>
            <span>{getProblemText(attempt).prompt || `${attempt.nodeId} · ${attempt.problemId}`}</span>
            <small>{getAttemptResult(attempt)}</small>
          </div>
        ))
      ) : (
        <p>아직 저장된 학습 기록이 없습니다.</p>
      )}
    </div>
  );
}

function getFrequentWrongProblems(attempts) {
  const grouped = new Map();
  attempts
    .filter((attempt) => attempt.status === "wrong" || attempt.wrong)
    .forEach((attempt) => {
      const key = `${attempt.nodeId}-${attempt.problemId}`;
      const current = grouped.get(key) || {
        nodeId: attempt.nodeId,
        problemId: attempt.problemId,
        ...getProblemText(attempt),
        submittedAnswer: getSubmittedAnswer(attempt),
        count: 0,
      };
      grouped.set(key, { ...current, count: current.count + 1 });
    });
  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function Confetti({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff922b", "#cc5de8", "#f783ac", "#20c997"];
    const cx = canvas.width / 2;
    const particles = Array.from({ length: 160 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 14;
      return {
        x: cx + (Math.random() - 0.5) * canvas.width * 0.5,
        y: canvas.height + 10,
        w: 7 + Math.random() * 7,
        h: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        vx: Math.cos(angle) * speed * 0.6,
        vy: -(8 + Math.random() * 12),
        vr: (Math.random() - 0.5) * 0.22,
        gravity: 0.28,
      };
    });
    let raf;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.vr;
        if (p.y < canvas.height + 30 && p.y > -30) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, width: "100%", height: "100%" }}
    />
  );
}

const NotebookPanel = forwardRef(function NotebookPanel(
  {
    skill,
    problems,
    selectedProblem,
    selectedProblemId,
    setSelectedProblemId,
    answerCheck,
    saving,
    solvedCount,
    totalProblemCount,
    solvedIds = [],
    guidePenaltyRate,
    onAnswerCheck,
  },
  ref,
) {
  const [answerInput, setAnswerInput] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [tool, setTool] = useState("pen");
  const [showGrid, setShowGrid] = useState(false);
  const [handMode, setHandMode] = useState(false);
  const [mobileSolveOpen, setMobileSolveOpen] = useState(true);
  const showGridRef = useRef(false);
  const handModeRef = useRef(false);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const ctxRef = useRef(null);
  const strokesRef = useRef([]);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const lastPointRef = useRef(null);
  const activePointerIdRef = useRef(null);
  const toolRef = useRef(tool);
  const scrollLockYRef = useRef(0);

  useEffect(() => {
    toolRef.current = tool;
    hideCursor();
  }, [tool]);

  useEffect(() => {
    showGridRef.current = showGrid;
  }, [showGrid]);

  useEffect(() => {
    handModeRef.current = handMode;
  }, [handMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      const rect = container.getBoundingClientRect();
      const nextWidth = Math.floor(rect.width * ratio);
      const nextHeight = Math.floor(rect.height * ratio);
      if (canvas.width === nextWidth && canvas.height === nextHeight) return;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctxRef.current = canvas.getContext("2d", { alpha: true, desynchronized: true });
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const options = { passive: false };
    canvas.addEventListener("pointerdown", startDrawing, options);
    canvas.addEventListener("pointermove", moveDrawing, options);
    canvas.addEventListener("pointerup", endDrawing, options);
    canvas.addEventListener("pointercancel", endDrawing, options);
    canvas.addEventListener("pointerleave", hideCursor);
    canvas.addEventListener("pointerenter", updateCursor);

    return () => {
      canvas.removeEventListener("pointerdown", startDrawing);
      canvas.removeEventListener("pointermove", moveDrawing);
      canvas.removeEventListener("pointerup", endDrawing);
      canvas.removeEventListener("pointercancel", endDrawing);
      canvas.removeEventListener("pointerleave", hideCursor);
      canvas.removeEventListener("pointerenter", updateCursor);
    };
  }, []);

  useEffect(() => {
    clearCanvas();
    setAnswerInput("");
    setShowConfetti(false);
  }, [selectedProblemId]);


  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * ratioX,
      y: (event.clientY - rect.top) * ratioY,
    };
  }

  function getCssPoint(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function drawStroke(stroke) {
    if (stroke.points.length < 2) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : "#111827";
    ctx.lineWidth = stroke.tool === "eraser" ? 30 : 3.5;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
    ctx.restore();
  }

  function drawSegment(from, to, strokeTool) {
    const ctx = ctxRef.current;
    if (!ctx || !from || !to) return;
    ctx.save();
    ctx.globalCompositeOperation = strokeTool === "eraser" ? "destination-out" : "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = strokeTool === "eraser" ? "rgba(0,0,0,1)" : "#111827";
    ctx.lineWidth = strokeTool === "eraser" ? 30 : 3.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = ctxRef.current || canvas.getContext("2d", { alpha: true, desynchronized: true });
    ctxRef.current = ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach(drawStroke);
  }

  function clearCanvas() {
    strokesRef.current = [];
    currentStrokeRef.current = [];
    lastPointRef.current = null;
    redraw();
  }

  function startDrawing(event) {
    if (event.pointerType === "touch" && !handModeRef.current) return;
    if (!toolRef.current) return; // 펜·지우개가 모두 비활성이면 그리지 않음
    event.preventDefault();
    event.stopPropagation();
    drawingRef.current = true;
    activePointerIdRef.current = event.pointerId;
    scrollLockYRef.current = window.scrollY;
    document.body.classList.add("drawing-on-canvas");
    const point = getPoint(event);
    currentStrokeRef.current = [point];
    lastPointRef.current = point;
    canvasRef.current.setPointerCapture(event.pointerId);
  }

  function moveDrawing(event) {
    if (event.pointerType === "touch" && !handModeRef.current) return;
    if (activePointerIdRef.current != null && event.pointerId !== activePointerIdRef.current) return;
    updateCursor(event);
    if (!drawingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (window.scrollY !== scrollLockYRef.current) window.scrollTo(window.scrollX, scrollLockYRef.current);
    const point = getPoint(event);
    const lastPoint = lastPointRef.current;
    if (!lastPoint) {
      lastPointRef.current = point;
      return;
    }
    currentStrokeRef.current.push(point);
    drawSegment(lastPoint, point, toolRef.current);
    lastPointRef.current = point;
  }

  function endDrawing(event) {
    if (activePointerIdRef.current != null && event?.pointerId !== activePointerIdRef.current) return;
    if (!drawingRef.current) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    drawingRef.current = false;
    document.body.classList.remove("drawing-on-canvas");
    if (window.scrollY !== scrollLockYRef.current) window.scrollTo(window.scrollX, scrollLockYRef.current);
    strokesRef.current.push({ tool: toolRef.current, points: currentStrokeRef.current });
    currentStrokeRef.current = [];
    lastPointRef.current = null;
    activePointerIdRef.current = null;
    if (event?.pointerId != null && canvasRef.current?.hasPointerCapture?.(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function updateCursor(event) {
    const cursor = cursorRef.current;
    if (!cursor) return;
    if (toolRef.current !== "eraser") {
      cursor.style.opacity = "0";
      return;
    }
    const point = getCssPoint(event);
    cursor.style.opacity = "1";
    cursor.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
  }

  function hideCursor() {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
    if (!drawingRef.current) document.body.classList.remove("drawing-on-canvas");
  }

  useImperativeHandle(ref, () => ({
    exportStrokes: () => strokesRef.current,
    getStrokeSummary: () => `${strokesRef.current.length}개 획으로 풀이 작성`,
    exportCanvasImage: () => {
      const canvas = canvasRef.current;
      if (!canvas || strokesRef.current.length === 0) return null;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const exportCtx = exportCanvas.getContext("2d");
      exportCtx.fillStyle = "#ffffff";
      exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportCtx.drawImage(canvas, 0, 0);
      return exportCanvas.toDataURL("image/jpeg", 0.85);
    },
  }));

  const solvedSet = new Set(solvedIds);
  const answerInputExample = getAnswerInputExample(selectedProblem);

  return (
    <section className={`notebook-panel ${mobileSolveOpen ? "" : "mobile-solve-collapsed"}`}>
      <Confetti active={showConfetti} />
      <div className="problem-header">
        <div>
          <span>{skill.stage} · {skill.unit}</span>
          <h2>{skill.title}</h2>
        </div>
        <div className="problem-header-actions">
          <select value={selectedProblemId} onChange={(event) => setSelectedProblemId(event.target.value)}>
            {problems.map((problem) => (
              <option className={solvedSet.has(problem.id) ? "solved-problem-option" : ""} value={problem.id} key={problem.id}>
                {solvedSet.has(problem.id) ? `✓ ${problem.title}` : problem.title}
              </option>
            ))}
          </select>
          <button className="mobile-solve-toggle" type="button" onClick={() => setMobileSolveOpen((open) => !open)}>
            {mobileSolveOpen ? "접기" : "풀이"}
          </button>
        </div>
      </div>

      {/* Skill progress bar */}
      <div className="skill-progress-bar">
        <div className="skill-progress-meta">
          <span><BookOpen size={12} /> 스킬 진행도</span>
          <strong>{Math.min(totalProblemCount, solvedCount)}문제 완료</strong>
        </div>
        <div className="skill-progress-track">
          <div className="skill-progress-fill" style={{ width: `${Math.min(100, solvedCount / Math.max(1, totalProblemCount) * 100)}%` }} />
        </div>
      </div>

      <article className="problem-card">
        <div className="problem-card-meta">
          <span>{"★".repeat(selectedProblem?.difficulty || 1)}{"☆".repeat(Math.max(0, 5 - (selectedProblem?.difficulty || 1)))}</span>
          {(() => {
            const baseXp = 30 + (selectedProblem?.difficulty || 1) * 10;
            const mult = Math.max(0.3, 1 - (guidePenaltyRate || 0));
            const earnXp = Math.round(baseXp * mult);
            return guidePenaltyRate > 0
              ? <span className="problem-xp penalty">+{earnXp} XP <s style={{opacity:0.5, fontSize:"0.75em"}}>{baseXp}</s> <small style={{color:"#f59e0b"}}>(-{Math.round((1-mult)*100)}%)</small></span>
              : <span className="problem-xp">+{baseXp} XP</span>;
          })()}
        </div>
        <p>{selectedProblem?.prompt}</p>
        <ProblemAssets assets={selectedProblem?.assets || []} />
      </article>

      <div className="solve-workspace">
      <div className="tool-row">
        <button className={tool === "pen" ? "active" : ""} onClick={() => setTool((t) => (t === "pen" ? "" : "pen"))}>
          <PenLine size={17} />
          펜
        </button>
        <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool((t) => (t === "eraser" ? "" : "eraser"))}>
          <Eraser size={17} />
          지우개
        </button>
        <button className="note-clear-btn" onClick={clearCanvas}>
          <RefreshCw size={17} />
          새 노트
        </button>
        <button
          className={`hand-toggle ${handMode ? "active" : ""}`}
          onClick={() => setHandMode((prev) => !prev)}
          title={handMode ? "손글씨 켜짐: 손가락으로 바로 쓸 수 있어요" : "손글씨 끄기: 손가락 글씨를 막아요"}
          aria-pressed={handMode}
        >
          <Hand size={17} />
          손글씨
        </button>
        <button
          className={`grid-toggle ${showGrid ? "active" : ""}`}
          onClick={() => setShowGrid((prev) => !prev)}
          title="눈금 표시"
          style={{ marginLeft: "auto" }}
        >
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="6" height="6" rx="0.5"/><rect x="10" y="1" width="6" height="6" rx="0.5"/>
            <rect x="1" y="10" width="6" height="6" rx="0.5"/><rect x="10" y="10" width="6" height="6" rx="0.5"/>
          </svg>
          눈금
        </button>
      </div>

      <div className="canvas-with-choices">
        <div className={`canvas-wrap ${showGrid ? "show-grid" : ""}`}>
          <div className="eraser-cursor" ref={cursorRef} />
          <canvas
            ref={canvasRef}
          />
        </div>

        {selectedProblem?.choices?.length > 0 && (
          <div className={`mc-choices ${answerCheck?.status || ""} ${shaking ? "shaking" : ""}`}>
            {selectedProblem.choices.map((choice, idx) => {
              const isSelected = answerInput === choice;
              const isCorrect = answerCheck?.status === "correct" && isSelected;
              const isWrong = answerCheck?.status === "wrong" && isSelected;
              return (
                <button
                  key={idx}
                  className={`mc-choice ${isSelected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`}
                  onClick={async () => {
                    if (answerCheck?.status === "correct") return;
                    setAnswerInput(choice);
                    const correct = await onAnswerCheck(choice);
                    if (correct) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3200); }
                    else { setShaking(true); setTimeout(() => setShaking(false), 500); }
                  }}
                  disabled={saving}
                >
                  <span className="mc-num">{"①②③④⑤"[idx]}</span>
                  {choice}
                </button>
              );
            })}
            {answerCheck?.status === "correct" && <small className="answer-msg correct">✓ 정답입니다!</small>}
            {answerCheck?.status === "wrong" && <small className="answer-msg wrong">✗ 오답입니다. 힌트·풀이 방향을 활용하세요.</small>}
          </div>
        )}
      </div>

      <div className={`answer-section ${answerCheck?.status || ""} ${shaking ? "shaking" : ""}`}>
        {!(selectedProblem?.choices?.length > 0) && (
          <div className="answer-input-row">
            <input
              value={answerInput}
              onChange={(event) => setAnswerInput(event.target.value)}
              placeholder={answerInputExample || "정답 입력"}
              onKeyDown={async (event) => {
                if (event.key === "Enter" && answerInput.trim()) {
                  const correct = await onAnswerCheck(answerInput);
                  if (correct) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3200); }
                  else { setShaking(true); setTimeout(() => setShaking(false), 500); }
                }
              }}
            />
            <button className="answer-confirm-btn" onClick={async () => {
              const correct = await onAnswerCheck(answerInput);
              if (correct) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3200); }
              else { setShaking(true); setTimeout(() => setShaking(false), 500); }
            }} disabled={saving || !answerInput.trim()}>
              확인
            </button>
          </div>
        )}
        {!(selectedProblem?.choices?.length > 0) && answerInputExample && <small className="answer-example">{answerInputExample}</small>}
        {!(selectedProblem?.choices?.length > 0) && answerCheck?.status === "correct" && <small className="answer-msg correct">✓ 정답입니다!</small>}
        {!(selectedProblem?.choices?.length > 0) && answerCheck?.status === "wrong" && <small className="answer-msg wrong">✗ 오답입니다. 힌트·풀이 방향을 활용하세요.</small>}
      </div>
      </div>
    </section>
  );
});

function ProblemAssets({ assets }) {
  const visibleAssets = assets.filter((asset) => asset.url);
  if (!visibleAssets.length) return null;

  return (
    <div className="problem-assets">
      {visibleAssets.map((asset) => (
        <figure key={asset.url}>
          <img src={asset.url} alt={asset.label || "문제 참고 자료"} />
          {asset.label && <figcaption>{asset.label}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function GuidePanel({ problem, guide, guideLoading, reviewCount, answerCheck, isAdmin, onGuide }) {
  const canReview = answerCheck?.status === "wrong";
  const cleanedGuide = cleanGuideMarkdown(guide);
  // 로그인 직후에는 펼친 상태로 시작한다. (모바일은 우측 버튼으로 접을 수 있음)
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`guide-panel ${collapsed ? "guide-collapsed" : ""}`}>
      <div className="section-title">
        <Wand2 size={18} />
        <h2>풀이 도우미</h2>
        <button
          type="button"
          className="guide-collapse-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>

      <div className="guide-actions">
        {guideActions.map((action) => {
          const Icon = action.icon;
          const isCheck = action.key === "check";
          const disabled = guideLoading || (isCheck ? !canReview || reviewCount >= 1 : false);
          return (
            <button key={action.key} onClick={() => onGuide(action)} disabled={disabled}>
              <Icon size={17} />
              <span>{action.label}</span>
              {action.xpPenalty && <small>XP -{Math.round(action.xpPenalty * 100)}%</small>}
              {action.key === "concept" && <small className="free">XP -0%</small>}
            </button>
          );
        })}
      </div>

      <div className="guide-output">
        {guideLoading && <Loader2 className="spin" size={20} />}
        <MarkdownContent>{cleanedGuide}</MarkdownContent>
      </div>

      {isAdmin && (
        <div className="answer-box">
          <span>정답 확인용</span>
          <strong>{problem?.answer}</strong>
          <small>admin 권한에서만 표시됩니다.</small>
        </div>
      )}

      <div className="tablet-note">
        <MousePointer2 size={16} />
        펜·터치 입력 지원
      </div>
    </aside>
  );
}

function cleanGuideMarkdown(markdown) {
  return String(markdown || "")
    .replace(/^#{1,4}\s*개념\s*(다시보기|보기|학습)\s*\n+/i, "")
    .replace(/^개념\s*(다시보기|보기|학습)\s*\n+/i, "")
    .replace(/^\*\*[^*\n]+·[^*\n]+\*\*\s*\n+/i, "")
    .trim();
}

function MarkdownContent({ children }) {
  const lines = String(children || "").split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const Tag = `h${Math.min(4, heading[1].length + 1)}`;
      blocks.push(<Tag key={`h-${index}`}>{renderInlineMarkdown(heading[2])}</Tag>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(line)}</p>);
    index += 1;
  }

  return blocks;
}

function renderInlineMarkdown(text) {
  const parts = String(text || "").split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
