import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const customAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
const authDomain = customAuthDomain || "study-1b905.firebaseapp.com";

export const firebaseConfig = {
  apiKey: "AIzaSyBo8Vkv0U9XLggRF95e-Qes4A4TSfe2VPQ",
  authDomain,
  projectId: "study-1b905",
  storageBucket: "study-1b905.firebasestorage.app",
  messagingSenderId: "977103150404",
  appId: "1:977103150404:web:9a6878941723397fd80b11",
  measurementId: "G-ZBTK4RP245",
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

function getAuthInstance() {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = getAuthInstance();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
export const db = getFirestore(app);
