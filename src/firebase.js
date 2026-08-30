import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseAuthDomain = (() => {
  if (typeof window === "undefined") return "study-1b905.firebaseapp.com";
  const { hostname, host, protocol } = window.location;
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local");
  return protocol === "https:" && !isLocal ? host : "study-1b905.firebaseapp.com";
})();

export const firebaseConfig = {
  apiKey: "AIzaSyBo8Vkv0U9XLggRF95e-Qes4A4TSfe2VPQ",
  authDomain: firebaseAuthDomain,
  projectId: "study-1b905",
  storageBucket: "study-1b905.firebasestorage.app",
  messagingSenderId: "977103150404",
  appId: "1:977103150404:web:9a6878941723397fd80b11",
  measurementId: "G-ZBTK4RP245",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
export const db = getFirestore(app);
