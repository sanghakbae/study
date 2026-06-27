import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  arrayUnion,
} from "firebase/firestore";
import { db } from "../firebase";
import { curriculumNodes } from "../data/curriculum";
import { generatedProblems } from "../data/problemBank";

export async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const role = user.email === "totoriverce@gmail.com" ? "admin" : "student";
  const isAdmin = role === "admin";
  let isNewUser = false;
  if (!snap.exists()) {
    isNewUser = true;
    await setDoc(ref, {
      uid: user.uid,
      displayName: user.displayName || "수학 러너",
      photoURL: user.photoURL || "",
      email: user.email || "",
      role,
      grade: "",
      parentOf: [],
      onboardingComplete: isAdmin,
      xp: 0,
      solvedCount: 0,
      masteredSkills: [],
      lastSkillId: "",
      lastProblemId: "",
      loginGuideDismissUntil: 0,
      firstLoginChatNotifiedAt: 0,
      firstLoginChatNotificationPending: true,
      aiGuideReviewCounts: {},
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, {
      lastSeenAt: serverTimestamp(),
      ...(isAdmin ? { role: "admin", onboardingComplete: true } : {}),
    });
  }
  return { ...(await getDoc(ref)).data(), isNewUser };
}

export async function seedCatalogIfNeeded() {
  const markerRef = doc(db, "system", "catalog");
  const marker = await getDoc(markerRef);
  if (marker.exists() && marker.data()?.version >= 7) return;

  await Promise.all([
    ...curriculumNodes.map((node) => setDoc(doc(db, "skills", node.id), node)),
    ...generatedProblems.map((problem) => setDoc(doc(db, "problems", problem.id), problem)),
    setDoc(markerRef, {
      seededAt: serverTimestamp(),
      version: 7,
      note: "교과서 기반 단원 문제(스킬당 30문제)로 교체.",
    }),
  ]);
}

export async function loadSkills() {
  const snap = await getDocs(collection(db, "skills"));
  return snap.docs.map((item) => item.data());
}

export async function loadProblemsBySkill(nodeId) {
  const q = query(collection(db, "problems"), where("nodeId", "==", nodeId), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map((item) => item.data());
}

export async function loadAllProblems() {
  const snap = await getDocs(collection(db, "problems"));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function upsertProblem(problem) {
  await setDoc(
    doc(db, "problems", problem.id),
    {
      ...problem,
      difficulty: Number(problem.difficulty) || 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function loadLeaderboard() {
  const q = query(collection(db, "users"), orderBy("xp", "desc"), limit(20));
  const snap = await getDocs(q);
  return snap.docs.map((item) => item.data());
}

export async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function loadProgressForUser(uid) {
  const q = query(collection(db, "progress"), where("uid", "==", uid));
  const snap = await getDocs(q);
  const result = {};
  for (const d of snap.docs) {
    const data = d.data();
    if (data.nodeId && data.solvedProblemIds?.length) {
      result[data.nodeId] = data.solvedProblemIds;
    }
  }
  const attemptsQuery = query(collection(db, "attempts"), where("uid", "==", uid), limit(500));
  const attemptsSnap = await getDocs(attemptsQuery);
  attemptsSnap.docs.forEach((d) => {
    const data = d.data();
    if (!data.completed || !data.nodeId || !data.problemId) return;
    const solved = new Set(result[data.nodeId] || []);
    solved.add(data.problemId);
    result[data.nodeId] = Array.from(solved);
  });
  return result;
}

export async function loadProgressForUsers(userIds) {
  if (!userIds.length) return [];
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const results = [];
  for (const uid of uniqueUserIds) {
    const q = query(collection(db, "progress"), where("uid", "==", uid));
    const snap = await getDocs(q);
    results.push(...snap.docs.map((item) => ({ id: item.id, ...item.data() })));
  }
  return results;
}

export async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((item) => item.data())
    .sort((a, b) => String(a.displayName || a.email || "").localeCompare(String(b.displayName || b.email || "")));
}

export async function clearUserProgress(uid) {
  const q = query(collection(db, "progress"), where("uid", "==", uid));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => setDoc(d.ref, { uid, nodeId: d.data().nodeId, solvedProblemIds: [], completedCount: 0, updatedAt: serverTimestamp() }, { merge: false })));
}

export async function updateUserRole({ uid, role, parentOf = [], displayName, grade, xp, solvedCount, onboardingComplete, resetProgress }) {
  if (resetProgress) {
    await clearUserProgress(uid);
  }
  await updateDoc(doc(db, "users", uid), {
    role,
    parentOf,
    ...(displayName != null ? { displayName } : {}),
    ...(grade != null ? { grade } : {}),
    ...(xp != null ? { xp: Number(xp) || 0 } : {}),
    ...(solvedCount != null ? { solvedCount: Number(solvedCount) || 0 } : {}),
    ...(onboardingComplete != null ? { onboardingComplete } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function updateStudyLocation({ uid, skillId, problemId }) {
  if (!uid || !skillId || !problemId) return;
  await setDoc(
    doc(db, "users", uid),
    {
      lastSkillId: skillId,
      lastProblemId: problemId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function suppressLoginGuideForSevenDays(uid) {
  if (!uid) return;
  await setDoc(
    doc(db, "users", uid),
    {
      loginGuideDismissUntil: Date.now() + 7 * 24 * 60 * 60 * 1000,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function markFirstLoginChatNotified(uid) {
  if (!uid) return;
  await setDoc(
    doc(db, "users", uid),
    {
      firstLoginChatNotifiedAt: Date.now(),
      firstLoginChatNotificationPending: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function markAiGuideUsed({ uid, problemId }) {
  if (!uid || !problemId) return;
  await updateDoc(doc(db, "users", uid), {
    [`aiGuideReviewCounts.${problemId}`]: 1,
    updatedAt: serverTimestamp(),
  });
}

export async function completeOnboarding({ user, role, grade }) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      displayName: user.displayName || "수학 러너",
      photoURL: user.photoURL || "",
      email: user.email || "",
      role,
      grade: role === "student" ? grade : "",
      parentOf: role === "parents" ? [] : [],
      onboardingComplete: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function loadAttemptsForUsers(userIds) {
  if (!userIds.length) return [];
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const results = [];
  for (const uid of uniqueUserIds) {
    const q = query(collection(db, "attempts"), where("uid", "==", uid), limit(300));
    const snap = await getDocs(q);
    results.push(...snap.docs.map((item) => ({ id: item.id, ...item.data() })));
  }
  return results.sort((a, b) => Number(b.completedAt?.seconds || b.createdAt?.seconds || 0) - Number(a.completedAt?.seconds || a.createdAt?.seconds || 0));
}

export async function loadAiUsageLogsForUsers(userIds) {
  if (!userIds.length) return [];
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const chunks = [];
  for (let index = 0; index < uniqueUserIds.length; index += 10) {
    chunks.push(uniqueUserIds.slice(index, index + 10));
  }
  const results = [];
  for (const chunk of chunks) {
    const q = query(collection(db, "aiUsageLogs"), where("uid", "in", chunk), limit(500));
    const snap = await getDocs(q);
    results.push(...snap.docs.map((item) => ({ id: item.id, ...item.data() })));
  }
  return results.sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
}

export async function loadAuditLogsForUsers(userIds) {
  if (!userIds.length) return [];
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const chunks = [];
  for (let index = 0; index < uniqueUserIds.length; index += 10) {
    chunks.push(uniqueUserIds.slice(index, index + 10));
  }
  const results = [];
  for (const chunk of chunks) {
    const q = query(collection(db, "auditLogs"), where("uid", "in", chunk), limit(500));
    const snap = await getDocs(q);
    results.push(...snap.docs.map((item) => ({ id: item.id, ...item.data() })));
  }
  return results.sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
}

export async function saveAuditLog({ user, action, category = "system", message = "", metadata = {} }) {
  if (!user?.uid || !action) return;
  const auditRef = doc(collection(db, "auditLogs"));
  await setDoc(auditRef, {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    role: metadata.role || "",
    action,
    category,
    message,
    metadata,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });
}

export async function saveAiUsageLog({ user, problem, action, usage, model }) {
  if (!usage) return;
  const usageRef = doc(collection(db, "aiUsageLogs"));
  await setDoc(usageRef, {
    uid: user.uid,
    problemId: problem?.id || "",
    nodeId: problem?.nodeId || "",
    problemTitle: problem?.title || "",
    action,
    model: model || "",
    inputTokens: Number(usage.inputTokens) || 0,
    outputTokens: Number(usage.outputTokens) || 0,
    totalTokens: Number(usage.totalTokens) || 0,
    createdAt: serverTimestamp(),
  });
  saveAuditLog({
    user,
    action: "ai_guide",
    category: "ai",
    message: `${action} 사용`,
    metadata: {
      problemId: problem?.id || "",
      nodeId: problem?.nodeId || "",
      model: model || "",
      totalTokens: Number(usage.totalTokens) || 0,
    },
  }).catch((error) => console.error("Audit AI log failed:", error));
}

export async function saveAttempt({ user, problem, strokes, guide, isCorrect, status, xpMultiplier = 1, submittedAnswer = "", helpUsed = [] }) {
  const completed = status === "completed";
  const wrong = status === "wrong";
  const attemptRef = doc(collection(db, "attempts"));
  const userRef = doc(db, "users", user.uid);
  const progressRef = doc(db, "progress", `${user.uid}_${problem.nodeId}`);

  // 트랜잭션: 원자 3-way 쓰기 + 서버에서 alreadySolved 검증 (클라이언트 상태 우회 방지)
  const xpGain = await runTransaction(db, async (transaction) => {
    const progressSnap = await transaction.get(progressRef);
    const alreadySolved = (progressSnap.data()?.solvedProblemIds || []).includes(problem.id);
    const baseXp = completed && !alreadySolved ? 30 + problem.difficulty * 10 : 0;
    const gain = Math.round(baseXp * Math.min(1, Math.max(0.3, xpMultiplier)));

    transaction.set(attemptRef, {
      uid: user.uid,
      problemId: problem.id,
      nodeId: problem.nodeId,
      problemTitle: problem.title || problem.id,
      problemPrompt: problem.prompt || "",
      submittedAnswer,
      helpUsed,
      strokes,
      guide,
      isCorrect: completed && isCorrect,
      status,
      wrong,
      completed,
      xpGain: gain,
      createdAt: serverTimestamp(),
      completedAt: completed ? serverTimestamp() : null,
    });

    transaction.update(userRef, {
      xp: increment(gain),
      solvedCount: increment(completed && !alreadySolved ? 1 : 0),
      lastActivityAt: serverTimestamp(),
      ...(completed ? { lastSolvedAt: serverTimestamp() } : {}),
    });

    transaction.set(
      progressRef,
      {
        uid: user.uid,
        nodeId: problem.nodeId,
        updatedAt: serverTimestamp(),
        ...(completed
          ? {
              solvedProblemIds: arrayUnion(problem.id),
              completedCount: increment(1),
              lastCompletedProblemId: problem.id,
            }
          : {}),
      },
      { merge: true },
    );

    return gain;
  });

  saveAuditLog({
    user,
    action: completed ? "problem_completed" : "problem_wrong",
    category: "learning",
    message: completed ? "문제 해결 완료" : "오답 제출",
    metadata: {
      problemId: problem.id,
      nodeId: problem.nodeId,
      problemTitle: problem.title || problem.id,
      submittedAnswer,
      status,
      xpGain,
      helpUsed,
    },
  }).catch((error) => console.error("Audit attempt log failed:", error));

  return { xpGain };
}

// 보너스 XP 지급(스킬 완주 등).
export async function awardBonusXp({ user, amount }) {
  if (!user || !amount) return;
  await updateDoc(doc(db, "users", user.uid), {
    xp: increment(amount),
    lastActivityAt: serverTimestamp(),
  });
}

// 시험 결과 저장 + (신규 합격 시) 보너스 XP 지급. examResults 맵은 user 문서에 저장한다.
export async function saveExamResult({ user, key, score, total, passed, bonusXp = 0 }) {
  if (!user || !key) return;
  const ref = doc(db, "users", user.uid);
  const result = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.data()?.examResults?.[key];
    const awardedBonus = Boolean(bonusXp && passed && !current?.passed);
    const nextPassed = Boolean(current?.passed || passed);
    transaction.update(ref, {
      [`examResults.${key}`]: {
        score: Math.max(Number(current?.score || 0), score),
        total,
        passed: nextPassed,
        at: Date.now(),
        lastScore: score,
      },
      ...(awardedBonus ? { xp: increment(bonusXp) } : {}),
      lastActivityAt: serverTimestamp(),
    });
    return { awardedBonus };
  });
  saveAuditLog({
    user,
    action: "exam_submitted",
    category: "exam",
    message: passed ? "시험 합격" : "시험 응시",
    metadata: { key, score, total, passed, bonusXp: result.awardedBonus ? bonusXp : 0 },
  }).catch((error) => console.error("Audit exam log failed:", error));
  return result;
}
