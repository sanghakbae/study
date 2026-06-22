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
  Medal,
  MousePointer2,
  PenLine,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Wand2,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import {
  completeOnboarding,
  ensureUserProfile,
  loadAttemptsForUsers,
  loadLeaderboard,
  loadProblemsBySkill,
  loadSkills,
  loadUsers,
  saveAttempt,
  seedCatalogIfNeeded,
  updateUserRole,
} from "./services/firestore";
import { curriculumNodes } from "./data/curriculum";
import { getProblemsForSkill } from "./data/problemBank";
import { externalProblemSources } from "./services/problemSources";

const fallbackUser = {
  displayName: "게스트",
  photoURL: "",
  role: "student",
  xp: 0,
  solvedCount: 0,
};

const guideActions = [
  { key: "next", label: "풀이 방향", icon: ChevronRight },
  { key: "hint", label: "힌트 받기", icon: HelpCircle },
  { key: "check", label: "내 풀이 점검", icon: ShieldCheck },
  { key: "concept", label: "개념 다시보기", icon: BookOpen },
];

const gradeOptions = ["중1", "중2", "중3", "고1", "고2", "고3"];

export default function App() {
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
  const [guide, setGuide] = useState("문제를 고르고 노트에 풀이를 시작하세요. 막히는 순간 오른쪽 버튼으로 힌트를 받을 수 있습니다.");
  const [guideLoading, setGuideLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [answerChecks, setAnswerChecks] = useState({});
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
    loadProblemsBySkill(selectedSkillId)
      .then((items) => {
        const nextProblems = items.length >= 50 ? items : getFallbackProblems(selectedSkill);
        setProblems(nextProblems);
        setSelectedProblemId(nextProblems[0]?.id || "");
        setGuide("새 문제를 열었습니다. 풀이를 쓰고 필요한 순간에 가이드를 요청하세요.");
      })
      .catch((error) => {
        console.error(error);
        const nextProblems = getFallbackProblems(selectedSkill);
        setProblems(nextProblems);
        setSelectedProblemId(nextProblems[0]?.id || "");
        setDataWarning("");
      });
  }, [selectedSkillId, selectedSkill, user]);

  async function refreshCatalog() {
    const [loadedSkills, loadedLeaders] = await Promise.all([loadSkills(), loadLeaderboard()]);
    if (loadedSkills.length) setSkills(loadedSkills);
    setLeaderboard(loadedLeaders);
    const me = loadedLeaders.find((item) => item.uid === auth.currentUser?.uid);
    if (me) {
      setProfile(me);
    }
  }

  async function refreshMembers(nextProfile = profile) {
    if (!user || !["admin", "parents"].includes(nextProfile.role)) {
      setMembers([]);
      setActivityAttempts([]);
      return;
    }

    const loadedUsers = await loadUsers();
    setMembers(loadedUsers);
    const targetUserIds =
      nextProfile.role === "admin"
        ? loadedUsers.filter((item) => item.role === "student").map((item) => item.uid)
        : nextProfile.parentOf || [];
    const attempts = await loadAttemptsForUsers(targetUserIds);
    setActivityAttempts(attempts);
  }

  useEffect(() => {
    refreshMembers().catch((error) => {
      console.error(error);
      setDataWarning(`회원/학습 기록 권한 확인 필요: ${error.message}`);
    });
  }, [profile.role, profile.parentOf, user]);

  async function handleLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      alert(`Google 로그인 실패: ${error.message}`);
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

  async function handleGuide(action) {
    if (action.key === "next") {
      setGuide(selectedProblem.nextStep || `## 다음 한 단계\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key === "hint") {
      setGuide(selectedProblem.hint || `## 힌트\n- ${selectedProblem.concept}`);
      return;
    }

    if (action.key === "concept") {
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
    if (usedCount >= 3) {
      setGuide("## 내 풀이 점검 제한\n- 이 문제의 풀이 점검은 최대 3회까지 사용할 수 있습니다.\n- 힌트와 개념 다시보기를 참고해서 다시 정리해 보세요.");
      return;
    }

    setGuideLoading(true);
    setGuide(`${action.label} 요청 중...`);
    try {
      const response = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action.label,
          problem: selectedProblem,
          noteSummary: notebookRef.current?.getStrokeSummary?.() || "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "OpenAI guide failed");
      setGuide(data.guide);
      setReviewCounts((current) => ({ ...current, [reviewKey]: usedCount + 1 }));
    } catch (error) {
      setGuide(
        `가이드 API 연결 전 임시 안내입니다.\n\n${selectedProblem.concept}\n\n다음 단계: 문제에서 주어진 값과 구해야 할 값을 먼저 분리한 뒤, 가장 직접적인 공식이나 등식으로 옮겨 보세요.\n\n오류: ${error.message}`,
      );
    } finally {
      setGuideLoading(false);
    }
  }

  function markProblemCompleted(problemId) {
    setSolvedBySkill((current) => {
      const solved = new Set(current[selectedSkillId] || []);
      solved.add(problemId);
      return { ...current, [selectedSkillId]: Array.from(solved) };
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

  async function handleSaveAttempt(completed) {
    if (!user || !selectedProblem) return;
    setSaving(true);
    try {
      await saveAttempt({
        user,
        problem: selectedProblem,
        strokes: notebookRef.current?.exportStrokes?.() || [],
        guide,
        isCorrect: completed,
        status: completed ? "completed" : "saved",
      });
      if (completed) {
        markProblemCompleted(selectedProblem.id);
        advanceToNextProblem(selectedProblem.id);
      } else {
        setGuide("풀이가 저장됐습니다. 해결 완료를 눌러야 다음 문제로 넘어갑니다.");
      }
      await refreshCatalog();
      await refreshMembers();
    } catch (error) {
      console.error(error);
      setGuide(`저장 실패: ${error.message}`);
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
    if (!user || !selectedProblem) return;
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
      return;
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
      });
      await refreshMembers();
    } catch (error) {
      console.error(error);
      setGuide(`오답 기록 저장 실패: ${error.message}`);
    }
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
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (!profile.onboardingComplete && profile.role !== "admin") {
    return <OnboardingPage user={user} profile={profile} onComplete={handleCompleteOnboarding} />;
  }

  if (profile.role === "admin") {
    return (
      <AdminPage
        user={user}
        profile={profile}
        leaders={leaderboard}
        members={members}
        attempts={activityAttempts}
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
        <Leaderboard leaders={leaderboard} currentUid={user.uid} />
      </section>

      <section
        className="workspace"
        ref={workspaceRef}
        style={{ gridTemplateColumns: `minmax(0, ${noteRatio}%) 12px minmax(420px, 1fr)` }}
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
        />

        <ResizeHandle workspaceRef={workspaceRef} onResize={setNoteRatio} />

        <GuidePanel
          problem={selectedProblem}
          guide={guide}
          guideLoading={guideLoading}
          reviewCount={reviewCounts[selectedProblem.id] || 0}
          answerCheck={answerChecks[selectedProblem.id]}
          isAdmin={profile.role === "admin"}
          saving={saving}
          onGuide={handleGuide}
          onAnswerCheck={handleAnswerCheck}
          onSave={handleSaveAttempt}
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

function AdminPage({ user, profile, leaders, members, attempts, onRoleUpdate }) {
  return (
    <main className="app-shell admin-shell">
      <Topbar user={user} profile={profile} />
      <section className="admin-layout">
        <Leaderboard leaders={leaders} currentUid={user.uid} />
        <section className="admin-panel">
          <div className="section-title">
            <ShieldCheck size={18} />
            <h2>관리자 페이지</h2>
          </div>
          <MemberManager members={members} onRoleUpdate={onRoleUpdate} />
        </section>
        <section className="admin-panel">
          <ActivityPanel members={members} attempts={attempts} />
        </section>
      </section>
    </main>
  );
}

function ParentPage({ user, profile, members, attempts, leaders, onRegisterChild }) {
  return (
    <main className="app-shell parent-shell">
      <Topbar user={user} profile={profile} />
      <section className="parent-layout">
        <ParentInsightPanel profile={profile} members={members} onRegisterChild={onRegisterChild} />
        <Leaderboard leaders={leaders} currentUid={user.uid} />
        <ActivityPanel members={members} attempts={attempts} />
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
        <div className="stat-pill">
          <Flame size={16} />
          <span>{profile.xp || 0} XP</span>
        </div>
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
          <button className="google-button" onClick={onLogin}>
            <UserRound size={18} />
            Google로 시작
          </button>
        </div>
      </div>
    </main>
  );
}

function OnboardingPage({ user, profile, onComplete }) {
  const [role, setRole] = useState(profile.role === "parents" ? "parents" : "student");
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
        {groupedSkills.map((group) => (
          <div className="skill-stage" key={group.stage}>
            <div className="skill-stage-header">{group.stage}</div>
            <div className="skill-stage-list">
              {group.skills.map((skill) => {
                const completed = completedSkills.includes(skill.id);
                const unlocked = unlockedSkills.has(skill.id);
                const selected = selectedSkillId === skill.id;
                const pending = unlocked && !completed;
                const solvedCount = solvedBySkill[skill.id]?.length || 0;
                return (
                  <button
                    className={`skill-node ${selected ? "selected" : ""} ${completed ? "completed" : ""} ${pending ? "pending" : ""} ${!unlocked ? "locked" : ""}`}
                    key={skill.id}
                    disabled={!unlocked}
                    onClick={() => onSelect(skill.id)}
                    title={skill.title}
                  >
                    <span className="skill-state">
                      {unlocked ? completed ? <CheckCircle2 size={15} /> : <Sparkles size={15} /> : <Lock size={15} />}
                    </span>
                    <span className="skill-unit">{skill.unit}</span>
                    <strong>{skill.title}</strong>
                    {selected && <em>진행 중</em>}
                    {unlocked && <small>{Math.min(50, solvedCount)}/50</small>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Leaderboard({ leaders, currentUid }) {
  return (
    <section className="leader-panel">
      <div className="section-title">
        <Crown size={18} />
        <h2>랭킹</h2>
      </div>
      <ol className="leader-list">
        {leaders.length ? leaders.slice(0, 6).map((leader, index) => (
          <li key={leader.uid} className={leader.uid === currentUid ? "me" : ""}>
            <span className="rank-badge">{index < 3 ? <Medal size={15} /> : index + 1}</span>
            <div>
              <strong>{formatStudentName(leader)}</strong>
              <small>{leader.solvedCount || 0}문제 해결</small>
            </div>
            <b>{leader.xp || 0}</b>
          </li>
        )) : <li className="empty-row">아직 랭킹 데이터가 없습니다.</li>}
      </ol>
    </section>
  );
}

function formatStudentName(member) {
  const name = member?.displayName || "러너";
  return member?.grade ? `${name} (${member.grade})` : name;
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
                <th>등급</th>
                <th>XP</th>
                <th>해결</th>
                <th>권한</th>
                <th>자녀</th>
              </tr>
            </thead>
            <tbody>
              {members.slice(0, 80).map((member) => (
                <tr key={member.uid}>
                  <td>
                    <strong>{formatStudentName(member)}</strong>
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
                      aria-label="등급"
                      placeholder="등급"
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

function ParentInsightPanel({ profile, members, onRegisterChild }) {
  const [childQuery, setChildQuery] = useState("");
  const students = members
    .filter((member) => member.role === "student")
    .sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const childIds = new Set(profile?.parentOf || []);
  const children = students.filter((student) => childIds.has(student.uid));
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
      <h3>자녀 학습 비교</h3>
      {onRegisterChild && (
        <div className="child-register">
          <label>
            <span>가입한 자녀 조회</span>
            <input
              value={childQuery}
              onChange={(event) => setChildQuery(event.target.value)}
              placeholder="자녀 이름 또는 이메일"
            />
          </label>
          <div className="child-candidates">
            {candidates.map((student) => (
              <button
                key={student.uid}
                onClick={() => {
                  onRegisterChild(student.uid);
                  setChildQuery("");
                }}
              >
                <strong>{formatStudentName(student)}</strong>
                <small>{student.email}</small>
              </button>
            ))}
            {childQuery.trim() && !candidates.length && <p>가입된 학생 중 일치하는 자녀가 없습니다.</p>}
          </div>
        </div>
      )}
      {children.length ? (
        children.map((child) => {
          const rankIndex = students.findIndex((student) => student.uid === child.uid);
          const above = rankIndex > 0 ? students[rankIndex - 1] : null;
          const xpDiff = (child.xp || 0) - avgXp;
          const solvedDiff = (child.solvedCount || 0) - avgSolved;
          return (
            <div className="child-card" key={child.uid}>
              <strong>{formatStudentName(child)}</strong>
              <span>전체 {rankIndex + 1}위 · {child.xp || 0} XP · {child.solvedCount || 0}문제</span>
              <div className="comparison-grid">
                <small className={xpDiff >= 0 ? "positive" : "negative"}>
                  평균 XP 대비 {formatSignedNumber(xpDiff)}
                </small>
                <small className={solvedDiff >= 0 ? "positive" : "negative"}>
                  평균 해결 수 대비 {formatSignedNumber(solvedDiff)}
                </small>
                <small>
                  {above ? `위 학생까지 ${Math.max(0, (above.xp || 0) - (child.xp || 0))} XP` : "현재 1위"}
                </small>
              </div>
            </div>
          );
        })
      ) : (
        <p>자녀를 선택하면 학습 통계와 다른 학생 대비 차이가 표시됩니다.</p>
      )}
    </div>
  );
}

function formatSignedNumber(value) {
  return value > 0 ? `+${value}` : `${value}`;
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
              <strong>{item.problemId}</strong>
              <span>{item.nodeId}</span>
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
            <strong>{memberName.get(attempt.uid) || "학생"}</strong>
            <span>{attempt.nodeId} · {attempt.problemId}</span>
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
        count: 0,
      };
      grouped.set(key, { ...current, count: current.count + 1 });
    });
  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
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
  },
  ref,
) {
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const ctxRef = useRef(null);
  const strokesRef = useRef([]);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const lastPointRef = useRef(null);
  const toolRef = useRef(tool);
  const scrollLockYRef = useRef(0);

  useEffect(() => {
    toolRef.current = tool;
    hideCursor();
  }, [tool]);

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
      ctxRef.current = canvas.getContext("2d", { alpha: false, desynchronized: true });
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.tool === "eraser" ? "#ffffff" : "#111827";
    ctx.lineWidth = stroke.tool === "eraser" ? 30 : 3.5;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }

  function drawSegment(from, to, strokeTool) {
    const ctx = ctxRef.current;
    if (!ctx || !from || !to) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = strokeTool === "eraser" ? "#ffffff" : "#111827";
    ctx.lineWidth = strokeTool === "eraser" ? 30 : 3.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = ctxRef.current || canvas.getContext("2d", { alpha: false, desynchronized: true });
    ctxRef.current = ctx;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach(drawStroke);
  }

  function clearCanvas() {
    strokesRef.current = [];
    currentStrokeRef.current = [];
    lastPointRef.current = null;
    redraw();
  }

  function startDrawing(event) {
    event.preventDefault();
    event.stopPropagation();
    drawingRef.current = true;
    scrollLockYRef.current = window.scrollY;
    document.body.classList.add("drawing-on-canvas");
    const point = getPoint(event);
    currentStrokeRef.current = [point];
    lastPointRef.current = point;
    canvasRef.current.setPointerCapture(event.pointerId);
  }

  function moveDrawing(event) {
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
    if (!drawingRef.current) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    drawingRef.current = false;
    document.body.classList.remove("drawing-on-canvas");
    if (window.scrollY !== scrollLockYRef.current) window.scrollTo(window.scrollX, scrollLockYRef.current);
    strokesRef.current.push({ tool: toolRef.current, points: currentStrokeRef.current });
    currentStrokeRef.current = [];
    lastPointRef.current = null;
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
  }));

  return (
    <section className="notebook-panel">
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

      <article className="problem-card">
        <span>난이도 {selectedProblem?.difficulty || 1}</span>
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
      </div>

      <div className="canvas-wrap">
        <div className="eraser-cursor" ref={cursorRef} />
        <canvas
          ref={canvasRef}
        />
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

function GuidePanel({ problem, guide, guideLoading, reviewCount, answerCheck, isAdmin, saving, onGuide, onAnswerCheck, onSave }) {
  const [answerInput, setAnswerInput] = useState("");
  const canReview = answerCheck?.status === "wrong";
  const canComplete = answerCheck?.status === "correct";

  useEffect(() => {
    setAnswerInput("");
  }, [problem?.id]);

  return (
    <aside className="guide-panel">
      <div className="section-title">
        <Wand2 size={18} />
        <h2>AI 가이드</h2>
      </div>

      <div className="guide-actions">
        {guideActions.map((action) => {
          const Icon = action.icon;
          const disabled = guideLoading || (action.key === "check" && !canReview);
          return (
            <button key={action.key} onClick={() => onGuide(action)} disabled={disabled}>
              <Icon size={17} />
              {action.label}
              {action.key === "check" && <small>{Math.max(0, 3 - reviewCount)}/3</small>}
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

      <div className={`answer-check ${answerCheck?.status || ""}`}>
        <label>
          <span>정답 입력</span>
          <input
            value={answerInput}
            onChange={(event) => setAnswerInput(event.target.value)}
            placeholder="계산한 답"
            onKeyDown={(event) => {
              if (event.key === "Enter" && answerInput.trim()) onAnswerCheck(answerInput);
            }}
          />
        </label>
        <button onClick={() => onAnswerCheck(answerInput)} disabled={saving || !answerInput.trim()}>
          정답 확인
        </button>
        {answerCheck?.status === "correct" && <small>정답입니다. 해결 완료를 누르세요.</small>}
        {answerCheck?.status === "wrong" && <small>오답입니다. 내 풀이 점검을 사용할 수 있습니다.</small>}
      </div>

      <div className="save-row">
        <button onClick={() => onSave(false)} disabled={saving}>
          <Save size={17} />
          풀이 저장
        </button>
        <button className="primary" onClick={() => onSave(true)} disabled={saving || !canComplete}>
          <Brush size={17} />
          해결 완료
        </button>
      </div>

      <div className="tablet-note">
        <MousePointer2 size={16} />
        Apple Pencil/S Pen/터치 입력에 맞춰 포인터 이벤트로 동작합니다.
      </div>
    </aside>
  );
}
