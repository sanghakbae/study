import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
  ensureUserProfile,
  loadLeaderboard,
  loadProblemsBySkill,
  loadSkills,
  saveAttempt,
  seedCatalogIfNeeded,
} from "./services/firestore";
import { curriculumNodes, sampleProblems } from "./data/curriculum";
import { externalProblemSources } from "./services/problemSources";

const fallbackUser = {
  displayName: "게스트",
  photoURL: "",
  xp: 0,
  solvedCount: 0,
};

const guideActions = [
  { key: "next", label: "다음 한 단계", icon: ChevronRight },
  { key: "hint", label: "힌트 받기", icon: HelpCircle },
  { key: "check", label: "내 풀이 점검", icon: ShieldCheck },
  { key: "concept", label: "개념 다시보기", icon: BookOpen },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(fallbackUser);
  const [authReady, setAuthReady] = useState(false);
  const [skills, setSkills] = useState(curriculumNodes);
  const [selectedSkillId, setSelectedSkillId] = useState("m1-numbers");
  const [problems, setProblems] = useState(sampleProblems.filter((item) => item.nodeId === "m1-numbers"));
  const [selectedProblemId, setSelectedProblemId] = useState("p-m1-numbers-01");
  const [leaderboard, setLeaderboard] = useState([]);
  const [guide, setGuide] = useState("문제를 고르고 노트에 풀이를 시작하세요. 막히는 순간 오른쪽 버튼으로 힌트를 받을 수 있습니다.");
  const [guideLoading, setGuideLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completedSkills, setCompletedSkills] = useState(["m1-numbers"]);
  const [tool, setTool] = useState("pen");
  const [dataWarning, setDataWarning] = useState("");
  const notebookRef = useRef(null);

  const selectedSkill = useMemo(
    () => skills.find((item) => item.id === selectedSkillId) || skills[0],
    [selectedSkillId, skills],
  );

  const selectedProblem = useMemo(
    () => problems.find((item) => item.id === selectedProblemId) || problems[0] || sampleProblems[0],
    [selectedProblemId, problems],
  );

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        setProfile({
          uid: nextUser.uid,
          displayName: nextUser.displayName || "수학 러너",
          photoURL: nextUser.photoURL || "",
          email: nextUser.email || "",
          xp: 0,
          solvedCount: 0,
        });
        try {
          await ensureUserProfile(nextUser);
          await seedCatalogIfNeeded();
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
    if (!user) return;
    loadProblemsBySkill(selectedSkillId)
      .then((items) => {
        const nextProblems = items.length ? items : sampleProblems.filter((item) => item.nodeId === selectedSkillId);
        setProblems(nextProblems);
        setSelectedProblemId(nextProblems[0]?.id || "");
        setGuide("새 문제를 열었습니다. 풀이를 쓰고 필요한 순간에 가이드를 요청하세요.");
      })
      .catch((error) => {
        console.error(error);
        const nextProblems = sampleProblems.filter((item) => item.nodeId === selectedSkillId);
        setProblems(nextProblems);
        setSelectedProblemId(nextProblems[0]?.id || "");
        setDataWarning(`문제 DB를 읽지 못해 내장 샘플로 표시 중: ${error.message}`);
      });
  }, [selectedSkillId, user]);

  async function refreshCatalog() {
    const [loadedSkills, loadedLeaders] = await Promise.all([loadSkills(), loadLeaderboard()]);
    if (loadedSkills.length) setSkills(loadedSkills);
    setLeaderboard(loadedLeaders);
    const me = loadedLeaders.find((item) => item.uid === auth.currentUser?.uid);
    if (me) {
      setProfile(me);
      setCompletedSkills(me.masteredSkills?.length ? me.masteredSkills : ["m1-numbers"]);
    }
  }

  async function handleLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      alert(`Google 로그인 실패: ${error.message}`);
    }
  }

  async function handleGuide(action) {
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
    } catch (error) {
      setGuide(
        `가이드 API 연결 전 임시 안내입니다.\n\n${selectedProblem.concept}\n\n다음 단계: 문제에서 주어진 값과 구해야 할 값을 먼저 분리한 뒤, 가장 직접적인 공식이나 등식으로 옮겨 보세요.\n\n오류: ${error.message}`,
      );
    } finally {
      setGuideLoading(false);
    }
  }

  async function handleSaveAttempt(isCorrect) {
    if (!user || !selectedProblem) return;
    setSaving(true);
    try {
      const result = await saveAttempt({
        user,
        problem: selectedProblem,
        strokes: notebookRef.current?.exportStrokes?.() || [],
        guide,
        isCorrect,
      });
      setGuide(`저장 완료. ${result.xpGain} XP를 획득했습니다.`);
      if (isCorrect) {
        setCompletedSkills((items) => Array.from(new Set([...items, selectedSkillId])));
      }
      await refreshCatalog();
    } catch (error) {
      console.error(error);
      setGuide(`저장 실패: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  const unlockedSkills = useMemo(() => {
    return new Set(
      skills
        .filter((skill) => skill.prereq.every((id) => completedSkills.includes(id)))
        .map((skill) => skill.id),
    );
  }, [skills, completedSkills]);

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

  return (
    <main className="app-shell">
      {dataWarning && <div className="warning-bar">{dataWarning}</div>}
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

      <section className="dashboard-strip">
        <SkillTree
          skills={skills}
          selectedSkillId={selectedSkillId}
          completedSkills={completedSkills}
          unlockedSkills={unlockedSkills}
          onSelect={setSelectedSkillId}
        />
        <Leaderboard leaders={leaderboard} currentUid={user.uid} />
      </section>

      <section className="workspace">
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

        <GuidePanel
          problem={selectedProblem}
          guide={guide}
          guideLoading={guideLoading}
          saving={saving}
          onGuide={handleGuide}
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

function SkillTree({ skills, selectedSkillId, completedSkills, unlockedSkills, onSelect }) {
  return (
    <section className="skill-panel">
      <div className="section-title">
        <Award size={18} />
        <h2>스킬 트리</h2>
      </div>
      <div className="skill-map">
        <svg className="skill-lines" viewBox="0 0 100 54" preserveAspectRatio="none">
          {skills.flatMap((skill) =>
            skill.prereq.map((parentId) => {
              const parent = skills.find((item) => item.id === parentId);
              if (!parent) return null;
              return (
                <line
                  key={`${parentId}-${skill.id}`}
                  x1={parent.position.x + 3}
                  y1={parent.position.y + 3}
                  x2={skill.position.x + 3}
                  y2={skill.position.y + 3}
                />
              );
            }),
          )}
        </svg>
        {skills.map((skill) => {
          const completed = completedSkills.includes(skill.id);
          const unlocked = unlockedSkills.has(skill.id);
          return (
            <button
              className={`skill-node ${selectedSkillId === skill.id ? "selected" : ""} ${completed ? "completed" : ""}`}
              key={skill.id}
              disabled={!unlocked}
              style={{ left: `${skill.position.x}%`, top: `${skill.position.y}%` }}
              onClick={() => onSelect(skill.id)}
              title={skill.title}
            >
              {unlocked ? completed ? <CheckCircle2 size={16} /> : <Sparkles size={16} /> : <Lock size={16} />}
              <span>{skill.stage}</span>
              <strong>{skill.title}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Leaderboard({ leaders, currentUid }) {
  const visible = leaders.length
    ? leaders
    : [
        { uid: "sample-a", displayName: "수열마스터", xp: 1240, solvedCount: 38 },
        { uid: "sample-b", displayName: "함수러너", xp: 980, solvedCount: 30 },
        { uid: "sample-c", displayName: "기하헌터", xp: 760, solvedCount: 22 },
      ];
  return (
    <section className="leader-panel">
      <div className="section-title">
        <Crown size={18} />
        <h2>랭킹</h2>
      </div>
      <ol className="leader-list">
        {visible.slice(0, 6).map((leader, index) => (
          <li key={leader.uid} className={leader.uid === currentUid ? "me" : ""}>
            <span className="rank-badge">{index < 3 ? <Medal size={15} /> : index + 1}</span>
            <div>
              <strong>{leader.displayName || "러너"}</strong>
              <small>{leader.solvedCount || 0}문제 해결</small>
            </div>
            <b>{leader.xp || 0}</b>
          </li>
        ))}
      </ol>
    </section>
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
  },
  ref,
) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
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

  function drawStroke(stroke) {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (stroke.points.length < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.tool === "eraser" ? "#ffffff" : "#111827";
    ctx.lineWidth = stroke.tool === "eraser" ? 28 : 4;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach(drawStroke);
  }

  function clearCanvas() {
    strokesRef.current = [];
    currentStrokeRef.current = [];
    redraw();
  }

  function startDrawing(event) {
    drawingRef.current = true;
    currentStrokeRef.current = [getPoint(event)];
    canvasRef.current.setPointerCapture(event.pointerId);
  }

  function moveDrawing(event) {
    if (!drawingRef.current) return;
    currentStrokeRef.current.push(getPoint(event));
    drawStroke({ tool, points: currentStrokeRef.current.slice(-2) });
  }

  function endDrawing() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    strokesRef.current.push({ tool, points: currentStrokeRef.current });
    currentStrokeRef.current = [];
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
        <canvas
          ref={canvasRef}
          onPointerDown={startDrawing}
          onPointerMove={moveDrawing}
          onPointerUp={endDrawing}
          onPointerCancel={endDrawing}
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

function GuidePanel({ problem, guide, guideLoading, saving, onGuide, onSave }) {
  return (
    <aside className="guide-panel">
      <div className="section-title">
        <Wand2 size={18} />
        <h2>AI 가이드</h2>
      </div>

      <div className="guide-actions">
        {guideActions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.key} onClick={() => onGuide(action)} disabled={guideLoading}>
              <Icon size={17} />
              {action.label}
            </button>
          );
        })}
      </div>

      <div className="guide-output">
        {guideLoading && <Loader2 className="spin" size={20} />}
        <p>{guide}</p>
      </div>

      <div className="answer-box">
        <span>정답 확인용</span>
        <strong>{problem?.answer}</strong>
        <small>운영 버전에서는 학생 시도 후 공개하거나 교사 설정으로 제어하세요.</small>
      </div>

      <div className="save-row">
        <button onClick={() => onSave(false)} disabled={saving}>
          <Save size={17} />
          풀이 저장
        </button>
        <button className="primary" onClick={() => onSave(true)} disabled={saving}>
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
