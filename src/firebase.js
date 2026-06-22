import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

export const firebaseConfig = {
  apiKey: "AIzaSyBo8Vkv0U9XLggRF95e-Qes4A4TSfe2VPQ",
  authDomain: "study-1b905.firebaseapp.com",
  projectId: "study-1b905",
  storageBucket: "study-1b905.firebasestorage.app",
  messagingSenderId: "977103150404",
  appId: "1:977103150404:web:9a6878941723397fd80b11",
  measurementId: "G-ZBTK4RP245",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) getAnalytics(app);
  });
}
