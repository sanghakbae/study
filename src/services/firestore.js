import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { curriculumNodes, sampleProblems } from "../data/curriculum";

export async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      displayName: user.displayName || "수학 러너",
      photoURL: user.photoURL || "",
      email: user.email || "",
      xp: 0,
      solvedCount: 0,
      masteredSkills: [],
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, { lastSeenAt: serverTimestamp() });
  }
}

export async function seedCatalogIfNeeded() {
  const markerRef = doc(db, "system", "catalog");
  const marker = await getDoc(markerRef);
  if (marker.exists() && marker.data()?.version >= 2) return;

  await Promise.all([
    ...curriculumNodes.map((node) => setDoc(doc(db, "skills", node.id), node)),
    ...sampleProblems.map((problem) => setDoc(doc(db, "problems", problem.id), problem)),
    setDoc(markerRef, {
      seededAt: serverTimestamp(),
      version: 2,
      note: "Expanded middle/high school math catalog seed.",
    }),
  ]);
}

export async function loadSkills() {
  const snap = await getDocs(collection(db, "skills"));
  return snap.docs.map((item) => item.data());
}

export async function loadProblemsBySkill(nodeId) {
  const q = query(collection(db, "problems"), where("nodeId", "==", nodeId), limit(12));
  const snap = await getDocs(q);
  return snap.docs.map((item) => item.data());
}

export async function loadLeaderboard() {
  const q = query(collection(db, "users"), orderBy("xp", "desc"), limit(20));
  const snap = await getDocs(q);
  return snap.docs.map((item) => item.data());
}

export async function saveAttempt({ user, problem, strokes, guide, isCorrect }) {
  const attemptRef = doc(collection(db, "attempts"));
  const xpGain = isCorrect ? 30 + problem.difficulty * 10 : 8;
  await setDoc(attemptRef, {
    uid: user.uid,
    problemId: problem.id,
    nodeId: problem.nodeId,
    strokes,
    guide,
    isCorrect,
    xpGain,
    createdAt: serverTimestamp(),
  });

  const userRef = doc(db, "users", user.uid);
  await updateDoc(userRef, {
    xp: increment(xpGain),
    solvedCount: increment(isCorrect ? 1 : 0),
    lastSolvedAt: serverTimestamp(),
  });
  return { xpGain };
}
