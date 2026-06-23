import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Award,
  BookOpen,
  Brush,
  CheckCircle2,
  ChevronRight,
  Crown,
  Eraser,
  Flame,
  Gamepad2,
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
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  ScrollText,
  Trophy,
  TrendingUp,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import {
  completeOnboarding,
  completeGuideWizard,
  ensureUserProfile,
  loadAiUsageLogsForUsers,
  loadAttemptsForUsers,
  loadAllProblems,
  loadLeaderboard,
  loadProblemsBySkill,
  loadProgressForUsers,
  loadProgressForUser,
  loadSkills,
  loadUserProfile,
  loadUsers,
  saveAiUsageLog,
  saveAttempt,
  seedCatalogIfNeeded,
  updateUserRole,
  upsertProblem,
} from "./services/firestore";
import { curriculumNodes } from "./data/curriculum";
import { generatedProblems, getProblemsForSkill } from "./data/problemBank";
import { externalProblemSources } from "./services/problemSources";

const fallbackUser = {
  displayName: "게스트",
  photoURL: "",
  role: "student",
  xp: 0,
  solvedCount: 0,
};

const guideActions = [
  { key: "check", label: "AI 가이드", icon: ShieldCheck },
  { key: "next", label: "풀이 방향", icon: ChevronRight, xpPenalty: true },
  { key: "hint", label: "힌트 받기", icon: HelpCircle, xpPenalty: true },
  { key: "concept", label: "개념 다시보기", icon: BookOpen, xpPenalty: true },
];

const gradeOptions = ["중1", "중2", "중3", "고1", "고2", "고3"];
const problemLookup = new Map(generatedProblems.map((problem) => [problem.id, problem]));

export default function App() {
  const isManagerPath = window.location.pathname === "/manager";
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(fallbackUser);
  const [authReady, setAuthReady] = useState(false);
  const [skills, setSkills] = useState(curriculumNodes);
  const [selectedSkillId, setSelectedSkillId] = useState("m1-numbers");
  const [problems, setProblems] = useState(getProblemsForSkill(curriculumNodes[0]));
  const [selectedProblemId, setSelectedProblemId] = useState("p-m1-numbers-01");
  const [leaderboard, setLeaderboard] = useState([]);
  const [members, setMembers] = useState([]);
  const [activityAttempts, setActivityAttempts] = useState([]);
  const [aiUsageLogs, setAiUsageLogs] = useState([]);
  const [guide, setGuide] = useState("문제를 고르고 노트에 풀이를 시작하세요. 막히는 순간 오른쪽 버튼으로 힌트를 받을 수 있습니다.");
  const [guideLoading, setGuideLoading] = useState(false);
  const [pendingRole, setPendingRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [answerChecks, setAnswerChecks] = useState({});
  const [hintUsed, setHintUsed] = useState({});
  const [reviewCounts, setReviewCounts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("study-review-counts") || "{}");
    } catch {
      return {};
    }
  });
  const [solvedBySkill, setSolvedBySkill] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("study-solved-by-skill") || "{}");
    } catch {
      return {};
    }
  });
  const [tool, setTool] = useState("pen");
  const [dataWarning, setDataWarning] = useState("");
  const [noteRatio, setNoteRatio] = useState(68);
  const notebookRef = useRef(null);
  const workspaceRef = useRef(null);

  const selectedSkill = useMemo(
    () => skills.find((item) => item.id === selectedSkillId) || skills[0],
    [selectedSkillId, skills],
  );

  const selectedProblem = useMemo(
    () => problems.find((item) => item.id === selectedProblemId) || problems[0] || getProblemsForSkill(curriculumNodes[0])[0],
    [selectedProblemId, problems],
  );

  useEffect(() => {
    localStorage.removeItem("study-note-ratio");
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
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
          if (nextUser.email === "totoriverce@gmail.com") {
            await seedCatalogIfNeeded();
          }
          await refreshCatalog();
          setDataWarning("");
        } catch (error) {
          console.error(error);
          setDataWarning(`Firestore 연결/권한 확인 필요: ${error.message}`);
        }
      }
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("study-review-counts", JSON.stringify(reviewCounts));
  }, [reviewCounts]);

  useEffect(() => {
    if (!user) return;
    const skill = skills.find((s) => s.id === selectedSkillId) || curriculumNodes.find((s) => s.id === selectedSkillId);
    loadProblemsBySkill(selectedSkillId)
      .then((items) => {
        const nextProblems = items.length >= 50 ? items : getFallbackProblems(skill);
        setProblems(nextProblems);
        setSelectedProblemId(nextProblems[0]?.id || "");
        setGuide("새 문제를 열었습니다. 풀이를 쓰고 필요한 순간에 가이드를 요청하세요.");
      })
      .catch((error) => {
        console.error(error);
        const nextProblems = getFallbackProblems(skill);
        setProblems(nextProblems);
        setSelectedProblemId(nextProblems[0]?.id || "");
        setDataWarning("");
      });
  }, [selectedSkillId, user]);

  async function refreshCatalog() {
    const uid = auth.currentUser?.uid;
    const [loadedSkills, loadedLeaders, progressMap] = await Promise.all([
      loadSkills(),
      loadLeaderboard(),
      uid ? loadProgressForUser(uid) : Promise.resolve({}),
    ]);
    if (loadedSkills.length) setSkills(loadedSkills);
    setLeaderboard(loadedLeaders.filter((u) => u.role === "student" && u.onboardingComplete && !u.isMock));
    let me = loadedLeaders.find((item) => item.uid === uid);
    if (!me && uid) {
      me = await loadUserProfile(uid);
    }
    if (me) setProfile(me);
    if (Object.keys(progressMap).length > 0) {
      setSolvedBySkill(progressMap);
    }
  }

  async function refreshMembers(nextProfile = profile) {
    if (!user || !["admin", "parents"].includes(nextProfile.role)) {
      setMembers([]);
      setActivityAttempts([]);
      setAiUsageLogs([]);
      return;
    }

    const loadedUsers = await loadUsers();
    setMembers(loadedUsers);
    const targetUserIds =
      nextProfile.role === "admin"
        ? loadedUsers.filter((item) => item.role === "student").map((item) => item.uid)
        : nextProfile.parentOf || [];
    const [attempts, progressDocs, usageLogs] = await Promise.all([
      loadAttemptsForUsers(targetUserIds),
      loadProgressForUsers(targetUserIds),
      loadAiUsageLogsForUsers(targetUserIds),
    ]);
    setActivityAttempts(mergeAttemptsWithProgress(attempts, progressDocs));
    setAiUsageLogs(usageLogs);
  }

  useEffect(() => {
    refreshMembers().catch((error) => {
      console.error(error);
      setDataWarning(`회원/학습 기록 권한 확인 필요: ${error.message}`);
    });
  }, [profile.role, profile.parentOf, user]);

  async function handleLogin(role) {
    setPendingRole(role);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setPendingRole(null);
      if (error.code === "auth/popup-blocked") {
        alert("팝업이 차단됐습니다.\n브라우저 주소창 오른쪽의 팝업 허용 아이콘을 클릭한 뒤 다시 시도해주세요.");
      } else if (error.code !== "auth/popup-closed-by-user") {
        alert(`Google 로그인 실패: ${error.message}`);
      }
    }
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
    await refreshMembers(nextProfile);
  }

  function getGuidePenaltyCount(problemId) {
    const used = hintUsed[problemId];
    if (Array.isArray(used)) return used.length;
    return Number(used) || 0;
  }

  function trackHintUse(problemId, actionKey) {
    setHintUsed((current) => {
      const previous = current[problemId];
      const used = Array.isArray(previous) ? previous : [];
      if (used.includes(actionKey)) return current;
      return { ...current, [problemId]: [...used, actionKey] };
    });
  }

  async function handleGuide(action) {
    if (action.key === "next") {
      trackHintUse(selectedProblem.id, action.key);
      setGuide(selectedProblem.nextStep || `## 다음 한 단계\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key === "hint") {
      trackHintUse(selectedProblem.id, action.key);
      setGuide(selectedProblem.hint || `## 힌트\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key === "concept") {
      trackHintUse(selectedProblem.id, action.key);
      setGuide(selectedProblem.conceptGuide || `## 개념 다시보기\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key !== "check") return;

    if (answerChecks[selectedProblem.id]?.status !== "wrong") {
      setGuide("## 먼저 정답 확인\n- 내 풀이 점검은 정답 확인 후 틀렸을 때만 사용할 수 있습니다.\n- 맞았다면 해결 완료를 눌러 다음 문제로 넘어가세요.");
      return;
    }

    const reviewKey = `${selectedProblem.id}`;
    const usedCount = reviewCounts[reviewKey] || 0;
    if (usedCount >= 1) {
      setGuide("## AI 가이드 사용 완료\n- AI 가이드는 문제당 1회만 사용할 수 있습니다.\n- 풀이 방향, 힌트, 개념 다시보기를 참고해서 다시 정리해 보세요.");
      return;
    }

    setReviewCounts((current) => ({ ...current, [reviewKey]: 1 }));
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
      const data = await response.json();
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
    } catch (error) {
      setGuide(
        `가이드 API 연결 전 임시 안내입니다.\n\n${selectedProblem.concept}\n\n다음 단계: 문제에서 주어진 값과 구해야 할 값을 먼저 분리한 뒤, 가장 직접적인 공식이나 등식으로 옮겨 보세요.\n\n오류: ${error.message}`,
      );
    } finally {
      setGuideLoading(false);
    }
  }

  function markProblemCompleted(problemId, nodeId = selectedSkillId) {
    setSolvedBySkill((current) => {
      const solved = new Set(current[nodeId] || []);
      solved.add(problemId);
      return { ...current, [nodeId]: Array.from(solved) };
    });
  }

  function advanceToNextProblem(completedProblemId) {
    const solved = new Set([...(solvedBySkill[selectedSkillId] || []), completedProblemId]);
    const nextProblem = problems.find((problem) => !solved.has(problem.id));
    if (nextProblem) {
      setSelectedProblemId(nextProblem.id);
      setGuide("다음 문제로 이동했습니다. 풀이를 완료해야 다음 문제로 넘어갑니다.");
      return;
    }
    setGuide("이 스킬의 50문제를 모두 완료했습니다. 스킬 트리에서 다음 열린 스킬을 선택하세요.");
  }

  async function handleSaveAttempt(completed, problemOverride = selectedProblem) {
    if (!user || !problemOverride) return;
    const problem = problemOverride;
    setSaving(true);

    const alreadySolved = (solvedBySkill[problem.nodeId] || []).includes(problem.id);
    const hints = getGuidePenaltyCount(problem.id);
    const helpUsed = Array.isArray(hintUsed[problem.id]) ? hintUsed[problem.id] : [];
    const xpMultiplier = Math.max(0.3, 1 - hints * 0.05);

    if (completed) {
      markProblemCompleted(problem.id, problem.nodeId);
      advanceToNextProblem(problem.id);
    }

    try {
      await saveAttempt({
        user,
        problem,
        strokes: notebookRef.current?.exportStrokes?.() || [],
        guide,
        isCorrect: completed,
        status: completed ? "completed" : "saved",
        alreadySolved,
        xpMultiplier,
        helpUsed,
      });
      if (!completed) {
        setGuide("풀이가 저장됐습니다. 해결 완료를 눌러야 다음 문제로 넘어갑니다.");
      }
      await refreshCatalog();
      await refreshMembers();
    } catch (error) {
      console.error(error);
      if (!completed) setGuide(`저장 실패: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function normalizeAnswer(value) {
    return String(value ?? "")
      .replace(/\s+/g, "")
      .replace(/[()]/g, "")
      .replace(/−/g, "-")
      .toLowerCase();
  }

  async function handleAnswerCheck(inputAnswer) {
    if (!user || !selectedProblem) return false;
    const correct = normalizeAnswer(inputAnswer) === normalizeAnswer(selectedProblem.answer);
    setAnswerChecks((current) => ({
      ...current,
      [selectedProblem.id]: {
        status: correct ? "correct" : "wrong",
        input: inputAnswer,
      },
    }));

    if (correct) {
      setGuide("정답입니다. 풀이 점검 없이 해결 완료를 눌러 다음 문제로 넘어가세요.");
      return true;
    }

    setGuide("정답이 아닙니다. 내 풀이 점검을 눌러 어디서 어긋났는지 확인하세요.");
    try {
      await saveAttempt({
        user,
        problem: selectedProblem,
        strokes: notebookRef.current?.exportStrokes?.() || [],
        guide,
        isCorrect: false,
        status: "wrong",
        submittedAnswer: inputAnswer,
        helpUsed: Array.isArray(hintUsed[selectedProblem.id]) ? hintUsed[selectedProblem.id] : [],
      });
      await refreshMembers();
    } catch (error) {
      console.error(error);
      setGuide(`오답 기록 저장 실패: ${error.message}`);
    }
    return false;
  }

  const completedSkills = useMemo(() => {
    return skills
      .filter((skill) => (solvedBySkill[skill.id]?.length || 0) >= 50)
      .map((skill) => skill.id);
  }, [skills, solvedBySkill]);

  const unlockedSkills = useMemo(() => {
    return new Set(
      skills
        .filter((skill) => skill.id === "m1-numbers" || skill.prereq.every((id) => completedSkills.includes(id)))
        .map((skill) => skill.id),
    );
  }, [skills, completedSkills]);

  useEffect(() => {
    localStorage.setItem("study-solved-by-skill", JSON.stringify(solvedBySkill));
  }, [solvedBySkill]);

  if (!authReady) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={34} />
      </main>
    );
  }

  if (!user) {
    return isManagerPath ? <ManagerLoginScreen onLogin={() => handleLogin("admin")} /> : <LoginScreen onLogin={handleLogin} />;
  }

  if (isManagerPath && profile.role !== "admin") {
    return <ManagerAccessDenied user={user} />;
  }

  if (!profile.onboardingComplete && profile.role !== "admin") {
    return <OnboardingPage user={user} profile={profile} initialRole={pendingRole} onComplete={handleCompleteOnboarding} />;
  }

  if (profile.role === "admin") {
    return (
      <AdminPage
        user={user}
        profile={profile}
        leaders={leaderboard}
        members={members}
        attempts={activityAttempts}
        aiUsageLogs={aiUsageLogs}
        onRoleUpdate={async (payload) => {
          await updateUserRole(payload);
          await refreshMembers();
          await refreshCatalog();
        }}
      />
    );
  }

  if (profile.role === "parents") {
    return (
      <ParentPage
        user={user}
        profile={profile}
        members={members}
        attempts={activityAttempts}
        leaders={leaderboard}
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
    );
  }

  return (
    <main className="app-shell">
      {dataWarning && <div className="warning-bar">{dataWarning}</div>}
      <Topbar user={user} profile={profile} />

      <section className="dashboard-strip">
        <SkillTree
          skills={skills}
          selectedSkillId={selectedSkillId}
          completedSkills={completedSkills}
          solvedBySkill={solvedBySkill}
          unlockedSkills={unlockedSkills}
          onSelect={setSelectedSkillId}
        />
        <Leaderboard leaders={leaderboard} currentUid={user.uid} profile={profile} />
      </section>

      <section
        className="workspace"
        ref={workspaceRef}
        style={{ gridTemplateColumns: `minmax(0, ${noteRatio}%) 12px minmax(0, 1fr)` }}
      >
        <NotebookPanel
          ref={notebookRef}
          tool={tool}
          setTool={setTool}
          skill={selectedSkill}
          problems={problems}
          selectedProblem={selectedProblem}
          selectedProblemId={selectedProblemId}
          setSelectedProblemId={setSelectedProblemId}
          answerCheck={answerChecks[selectedProblem.id]}
          saving={saving}
          solvedCount={solvedBySkill[selectedSkillId]?.length || 0}
          hintCount={getGuidePenaltyCount(selectedProblem?.id)}
          onAnswerCheck={handleAnswerCheck}
          onSave={handleSaveAttempt}
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

function AdminPage({ user, profile, members, attempts, aiUsageLogs, onRoleUpdate }) {
  const [activeMenu, setActiveMenu] = useState("stats");

  return (
    <main className="app-shell admin-shell">
      <Topbar user={user} profile={profile} />
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
          <AdminAuditLog members={members} attempts={attempts} />
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

function ParentPage({ user, profile, members, attempts, leaders, onRegisterChild }) {
  const childIds = new Set(profile?.parentOf || []);
  const children = members.filter((member) => member.role === "student" && childIds.has(member.uid));
  const primaryChild = children[0] || null;
  return (
    <main className="app-shell parent-shell">
      <Topbar user={user} profile={profile} />
      <section className="parent-layout">
        <ParentInsightPanel profile={profile} members={members} attempts={attempts} onRegisterChild={onRegisterChild} />
        <Leaderboard
          leaders={leaders}
          currentUid={primaryChild?.uid || user.uid}
          profile={primaryChild || profile}
          showMyStats={false}
          preview={false}
        />
      </section>
    </main>
  );
}

function Topbar({ user, profile }) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">
          <Gamepad2 size={22} />
        </div>
        <div>
          <strong>Study Math Arena</strong>
          <span>중등부터 고등까지, 스킬을 열며 푸는 수학</span>
        </div>
      </div>

      <div className="topbar-actions">
        {(profile.role || "student") === "student" && (
          <div className="stat-pill">
            <Flame size={16} />
            <span>{profile.xp || 0} XP</span>
          </div>
        )}
        <div className="user-pill">
          {user.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound size={18} />}
          <span>{user.displayName || "러너"}</span>
        </div>
        <button className="icon-button" onClick={() => signOut(auth)} aria-label="로그아웃">
          <LogOut size={18} />
        </button>
      </div>
    </header>
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

function ManagerAccessDenied({ user }) {
  return (
    <main className="login-screen">
      <div className="login-art">
        <div className="login-panel manager-login-panel">
          <div className="brand-mark large">
            <ShieldCheck size={34} />
          </div>
          <h1>관리자 페이지 접속</h1>
          <p className="manager-warning">관리자만 접속이 가능합니다.</p>
          <button className="google-button manager-google-button" onClick={() => signOut(auth)}>
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

function SkillTree({ skills, selectedSkillId, completedSkills, solvedBySkill, unlockedSkills, onSelect }) {
  const stageOrder = ["중1", "중2", "중3", "고1", "고2", "고3"];
  const groupedSkills = stageOrder.map((stage) => ({
    stage,
    skills: skills
      .filter((skill) => skill.stage === stage)
      .sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0) || (a.level ?? 0) - (b.level ?? 0)),
  }));

  return (
    <section className="skill-panel">
      <div className="section-title">
        <Award size={18} />
        <h2>스킬 트리</h2>
      </div>
      <div className="skill-board">
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
                                            {completed && !selected && <em className="done">✓</em>}
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

function Leaderboard({ leaders, currentUid, profile, showMyStats = true }) {
  const displayLeaders = buildActualLeaderboard(leaders, currentUid, profile);
  const myRank = displayLeaders.findIndex((l) => l.uid === currentUid) + 1;
  const myLeader = displayLeaders.find((l) => l.uid === currentUid) || profile;
  const xp = myLeader?.xp || 0;
  const solved = myLeader?.solvedCount || 0;
  const level = Math.floor(xp / 200) + 1;
  const xpPct = Math.min(100, Math.round((xp % 200) / 200 * 100));
  const visibleLeaders = displayLeaders.slice(0, 5);
  if (currentUid && !visibleLeaders.some((leader) => leader.uid === currentUid)) {
    const currentLeader = displayLeaders.find((leader) => leader.uid === currentUid);
    if (currentLeader) visibleLeaders.push(currentLeader);
  }

  return (
    <section className="leader-panel">
      <div className="section-title">
        <Crown size={18} />
        <h2>랭킹</h2>
      </div>

      {showMyStats && (
        <div className="my-stats-card">
          <div className="my-rank-card">
            {myLeader?.photoURL ? (
              <div className="leader-avatar">
                <img src={myLeader.photoURL} alt="" referrerPolicy="no-referrer" />
              </div>
            ) : (
              <div className="leader-avatar placeholder"><UserRound size={16} /></div>
            )}
            <div>
              <strong>{formatStudentName(myLeader)}</strong>
              <small>내 순위</small>
            </div>
            <b>{myRank > 0 ? `#${myRank}` : "-"}</b>
          </div>
          <div className="my-stats-row">
            <div className="my-stat">
              <span>{xp.toLocaleString()}</span>
            </div>
            <div className="my-stat">
              <span>{solved}</span>
            </div>
            <div className="my-stat">
              <span>{myRank > 0 ? `#${myRank}` : "-"}</span>
            </div>
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
  const name = member?.displayName || "러너";
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

function maskName(name) {
  if (!name) return "러너";
  const chars = [...name];
  if (chars.length <= 1) return name;
  if (chars.length === 2) return chars[0] + "*";
  return chars[0] + "*".repeat(chars.length - 2) + chars[chars.length - 1];
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

  async function handleParentOfChange(member, childUid) {
    await saveMember(member, {
      role: "parents",
      parentOf: childUid ? [childUid] : [],
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
                  <td>
                    <strong>{formatAdminMemberName(member, members)}</strong>
                    <small>{member.email}</small>
                  </td>
                  <td>
                    <input
                      defaultValue={member.displayName || ""}
                      onBlur={(event) => saveMember(member, { displayName: event.target.value })}
                      aria-label="학생 이름"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={member.grade || ""}
                      onBlur={(event) => saveMember(member, { grade: event.target.value })}
                      aria-label="학년"
                      placeholder="학년"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      defaultValue={member.xp || 0}
                      onBlur={(event) => saveMember(member, { xp: event.target.value })}
                      aria-label="XP"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      defaultValue={member.solvedCount || 0}
                      onBlur={(event) => saveMember(member, { solvedCount: event.target.value })}
                      aria-label="해결 수"
                    />
                  </td>
                  <td>
                    <button
                      className="member-reset-button"
                      onClick={async () => {
                        if (!window.confirm(`${member.displayName || member.email} 의 XP와 풀이 기록을 모두 초기화합니까?`)) return;
                        await saveMember(member, { xp: 0, solvedCount: 0, resetProgress: true });
                      }}
                    >초기화</button>
                  </td>
                  <td>
                    <select value={member.role || "student"} onChange={(event) => handleRoleChange(member, event.target.value)}>
                      <option value="student">student</option>
                      <option value="parents">parents</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    {(member.role || "student") === "parents" ? (
                      <select value={member.parentOf?.[0] || ""} onChange={(event) => handleParentOfChange(member, event.target.value)}>
                        <option value="">선택 안함</option>
                        {students.map((student) => (
                          <option value={student.uid} key={student.uid}>
                            {formatStudentName(student)}
                          </option>
                        ))}
                      </select>
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
        <StatCard label="상태" value={loading ? "로딩 중" : "준비"} />
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
              <th className="col-problem">개념 다시보기</th>
              <th className="col-status">저장</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((problem) => {
              const dirty = !!drafts[problem.id];
              return (
                <tr key={problem.id}>
                  <td className="col-category">{getSkillTitle(problem.nodeId)}</td>
                  <td className="col-problem-no">{problem.title?.replace(/\D+/g, "") || problem.id.split("-").pop()}</td>
                  <td className="col-difficulty">
                    <input
                      className="problem-cell-input small"
                      type="number"
                      min="1"
                      max="5"
                      value={problem.difficulty || 1}
                      onChange={(event) => updateDraft(problem.id, { difficulty: event.target.value })}
                    />
                  </td>
                  <td className="col-problem">
                    <textarea
                      className="problem-cell-input"
                      value={problem.prompt || ""}
                      onChange={(event) => updateDraft(problem.id, { prompt: event.target.value })}
                    />
                  </td>
                  <td className="col-answer">
                    <input
                      className="problem-cell-input answer"
                      value={problem.answer || ""}
                      onChange={(event) => updateDraft(problem.id, { answer: event.target.value })}
                    />
                  </td>
                  <td className="col-problem">
                    <textarea
                      className="problem-cell-input"
                      value={problem.hint || ""}
                      onChange={(event) => updateDraft(problem.id, { hint: event.target.value })}
                    />
                  </td>
                  <td className="col-problem">
                    <textarea
                      className="problem-cell-input"
                      value={problem.nextStep || ""}
                      onChange={(event) => updateDraft(problem.id, { nextStep: event.target.value })}
                    />
                  </td>
                  <td className="col-problem">
                    <textarea
                      className="problem-cell-input"
                      value={problem.conceptGuide || ""}
                      onChange={(event) => updateDraft(problem.id, { conceptGuide: event.target.value })}
                    />
                  </td>
                  <td className="col-status">
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
        <div className="admin-dashboard-actions">
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
            href={selectedStudent && parentEmails.length ? `mailto:${parentEmails.join(",")}?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}` : undefined}
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
      <div className="admin-chart-grid">
        <DonutChartCard title="전체 스킬 완료 현황" items={skillStatus} centerLabel="완료" />
        <DonutChartCard title="스킬별 해결 수" items={skillSolved} centerLabel="해결" />
        <DonutChartCard title="스킬별 오답 수" items={skillWrong} centerLabel="오답" />
        <DonutChartCard title="스킬별 도움 사용량" items={skillHelp} centerLabel="도움" />
      </div>
      <div className="admin-wide-chart">
        <ColumnChartCard title="최근 7일 학습 흐름" items={recentTrend} />
      </div>
    </section>
  );
}

function AdminAuditLog({ members, attempts }) {
  const [query, setQuery] = useState("");
  const rows = attempts.map((attempt) => {
    const member = members.find((item) => item.uid === attempt.uid);
    const problemText = getProblemText(attempt);
    return {
      id: attempt.id,
      date: formatAttemptDate(attempt),
      student: member ? formatAdminMemberName(member, members) : "학생",
      category: problemText.category,
      problem: problemText.prompt || `${attempt.nodeId} · ${attempt.problemId}`,
      answer: getSubmittedAnswer(attempt) || "-",
      result: getAttemptResult(attempt),
      resultClass: getAttemptResultClass(attempt),
      help: formatHelpUsed(attempt),
    };
  });
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
  const source = log.createdAt;
  if (!source) return "-";
  const time = typeof source.seconds === "number" ? source.seconds * 1000 : new Date(source).getTime();
  if (!time) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
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
    if (counts.some((count) => count >= 50)) {
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
  const datedAttempts = attempts.filter((attempt) => !attempt.restoredFromProfile && getAttemptTime(attempt));
  const now = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
    const value = datedAttempts.filter((attempt) => {
      const time = getAttemptTime(attempt);
      return time && new Date(time).toISOString().slice(0, 10) === key;
    }).length;
    return { label, value };
  });
}

function ParentInsightPanel({ profile, members, attempts, onRegisterChild }) {
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
      if (!queryText) return false;
      return `${student.displayName || ""} ${student.email || ""} ${student.grade || ""}`.toLowerCase().includes(queryText);
    })
    .slice(0, 6);
  const avgXp = students.length ? Math.round(students.reduce((sum, student) => sum + (student.xp || 0), 0) / students.length) : 0;
  const avgSolved = students.length
    ? Math.round(students.reduce((sum, student) => sum + (student.solvedCount || 0), 0) / students.length)
    : 0;

  return (
    <div className="parent-insight">
      <div className="section-title">
        <Users size={18} />
        <h2>자녀 학습 현황</h2>
      </div>

      {onRegisterChild && (
        <div className="child-register">
          <div className="child-search-wrap">
            <Search size={15} className="child-search-icon" />
            <input
              value={childQuery}
              onChange={(event) => setChildQuery(event.target.value)}
              placeholder="자녀 이름 또는 이메일로 검색"
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
                  <span>{maskName(student.displayName)}</span>
                  {student.grade && <em>{student.grade}</em>}
                </button>
              ))}
            </div>
          )}
          {childQuery.trim() && !candidates.length && (
            <p className="child-empty">일치하는 학생이 없습니다.</p>
          )}
        </div>
      )}

      <div className="child-list">
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
              <div className="child-rank-context">
                {above ? (
                  <span>위: {formatStudentName(above)} · {Math.max(0, (above.xp || 0) - (child.xp || 0)).toLocaleString()} XP 차이</span>
                ) : (
                  <span>현재 전체 1위입니다.</span>
                )}
                {below && (
                  <span>아래: {formatStudentName(below)} · {Math.max(0, (child.xp || 0) - (below.xp || 0)).toLocaleString()} XP 차이</span>
                )}
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
        createdAt: null,
        completedAt: null,
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
                    {showChildName && <td className="col-child">{childName.get(item.uid) || "자녀"}</td>}
                    <td className="col-date">-</td>
                    <td className="col-category">{item.category}</td>
                    <td className="col-problem">{item.prompt || item.nodeId}</td>
                    <td className="col-answer">{item.submittedAnswer || "기록 없음"}</td>
                    <td className="col-status"><strong className="wrong-status">오답 {item.count}회</strong></td>
                    <td className="col-help">-</td>
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
                      {showChildName && <td className="col-child">{childName.get(a.uid) || "자녀"}</td>}
                      <td className="col-date">{formatAttemptDate(a)}</td>
                      <td className="col-category">{problemText.category}</td>
                      <td className="col-problem">{problemText.prompt || `${a.nodeId} · ${a.problemId}`}</td>
                      <td className="col-answer">{getSubmittedAnswer(a) || (a.restoredFromProgress || a.restoredFromProfile ? "기록 없음" : "-")}</td>
                      <td className="col-status"><strong className={getAttemptResultClass(a)}>{getAttemptResult(a)}</strong></td>
                      <td className="col-help">{a.restoredFromProgress || a.restoredFromProfile ? "완료 기록" : formatHelpUsed(a)}</td>
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
  if (typeof source === "string") return new Date(source).getTime() || 0;
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
  if (attempt.saved || attempt.status === "saved") return "풀이 저장";
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
            <small>{attempt.completed ? "해결 완료" : "풀이 저장"}</small>
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
    tool,
    setTool,
    skill,
    problems,
    selectedProblem,
    selectedProblemId,
    setSelectedProblemId,
    answerCheck,
    saving,
    solvedCount,
    hintCount,
    onAnswerCheck,
    onSave,
  },
  ref,
) {
  const [answerInput, setAnswerInput] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const showGridRef = useRef(false);
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
    if (event.pointerType === "touch") return;
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
    if (event.pointerType === "touch") return;
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

  return (
    <section className="notebook-panel">
      <Confetti active={showConfetti} />
      <div className="problem-header">
        <div>
          <span>{skill.stage} · {skill.unit}</span>
          <h2>{skill.title}</h2>
        </div>
        <select value={selectedProblemId} onChange={(event) => setSelectedProblemId(event.target.value)}>
          {problems.map((problem) => (
            <option value={problem.id} key={problem.id}>
              {problem.title}
            </option>
          ))}
        </select>
      </div>

      {/* Skill progress bar */}
      <div className="skill-progress-bar">
        <div className="skill-progress-meta">
          <span><BookOpen size={12} /> 스킬 진행도</span>
          <strong>{Math.min(50, solvedCount)}문제 완료</strong>
        </div>
        <div className="skill-progress-track">
          <div className="skill-progress-fill" style={{ width: `${Math.min(100, solvedCount / 50 * 100)}%` }} />
        </div>
      </div>

      <article className="problem-card">
        <div className="problem-card-meta">
          <span>{"★".repeat(selectedProblem?.difficulty || 1)}{"☆".repeat(Math.max(0, 5 - (selectedProblem?.difficulty || 1)))}</span>
          {(() => {
            const baseXp = 30 + (selectedProblem?.difficulty || 1) * 10;
            const mult = Math.max(0.3, 1 - (hintCount || 0) * 0.05);
            const earnXp = Math.round(baseXp * mult);
            return hintCount > 0
              ? <span className="problem-xp penalty">+{earnXp} XP <s style={{opacity:0.5, fontSize:"0.75em"}}>{baseXp}</s> <small style={{color:"#f59e0b"}}>(-{Math.round((1-mult)*100)}%)</small></span>
              : <span className="problem-xp">+{baseXp} XP</span>;
          })()}
        </div>
        <p>{selectedProblem?.prompt}</p>
        <ProblemAssets assets={selectedProblem?.assets || []} />
      </article>

      <div className="tool-row">
        <button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")}>
          <PenLine size={17} />
          펜
        </button>
        <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")}>
          <Eraser size={17} />
          지우개
        </button>
        <button onClick={clearCanvas}>
          <RefreshCw size={17} />
          새 노트
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

      <div className={`canvas-wrap ${showGrid ? "show-grid" : ""}`}>
        <div className="eraser-cursor" ref={cursorRef} />
        <canvas
          ref={canvasRef}
        />
      </div>

      <div className={`answer-section ${answerCheck?.status || ""} ${shaking ? "shaking" : ""}`}>
        {selectedProblem?.choices?.length > 0 ? (
          <div className="mc-choices">
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
                    if (correct) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3200); setTimeout(() => onSave(true, selectedProblem), 1500); }
                    else { setShaking(true); setTimeout(() => setShaking(false), 500); }
                  }}
                  disabled={saving}
                >
                  <span className="mc-num">{"①②③④⑤"[idx]}</span>
                  {choice}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="answer-input-row">
            <input
              value={answerInput}
              onChange={(event) => setAnswerInput(event.target.value)}
              placeholder="정답 입력"
              onKeyDown={async (event) => {
                if (event.key === "Enter" && answerInput.trim()) {
                  const correct = await onAnswerCheck(answerInput);
                  if (correct) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3200); setTimeout(() => onSave(true, selectedProblem), 1500); }
                  else { setShaking(true); setTimeout(() => setShaking(false), 500); }
                }
              }}
            />
            <button className="answer-confirm-btn" onClick={async () => {
              const correct = await onAnswerCheck(answerInput);
              if (correct) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3200); setTimeout(() => onSave(true, selectedProblem), 1500); }
              else { setShaking(true); setTimeout(() => setShaking(false), 500); }
            }} disabled={saving || !answerInput.trim()}>
              확인
            </button>
          </div>
        )}
        {answerCheck?.status === "correct" && <small className="answer-msg correct">✓ 정답입니다!</small>}
        {answerCheck?.status === "wrong" && <small className="answer-msg wrong">✗ 오답입니다. 풀이 점검을 활용하세요.</small>}
        <div className="save-row">
          <button onClick={() => onSave(false)} disabled={saving}>
            <Save size={17} />
            풀이 저장
          </button>
          <button className="primary" onClick={() => onSave(true, selectedProblem)} disabled={saving || answerCheck?.status !== "correct"}>
            <CheckCircle2 size={17} />
            해결 완료
          </button>
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

  return (
    <aside className="guide-panel">
      <div className="section-title">
        <Wand2 size={18} />
        <h2>풀이 도우미</h2>
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
              {action.xpPenalty && <small>XP -5%</small>}
            </button>
          );
        })}
      </div>

      <div className="guide-output">
        {guideLoading && <Loader2 className="spin" size={20} />}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{guide}</ReactMarkdown>
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
