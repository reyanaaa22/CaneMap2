// Firebase SDK imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  signOut,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  getStorage,
  connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAWcIMy6hBF4aP6LTSS1PwtmZogUebAI4A",
  authDomain: "canemap-system.firebaseapp.com",
  projectId: "canemap-system",
  storageBucket: "canemap-system.firebasestorage.app",
  messagingSenderId: "624993566775",
  appId: "1:624993566775:web:5b1b72cb58203b46123fb2",
  measurementId: "G-08KFJQ1NEJ",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// 🔥 EMULATOR SETUP - Connect to local emulators in development
//if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  //console.log("🔥 Connected to Firebase Emulators");
  //connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  //connectFirestoreEmulator(db, "localhost", 8080);
  //connectStorageEmulator(storage, "localhost", 9199);
//}

// Expose commonly used auth helpers for non-module scripts
// This allows classic scripts (e.g., lobby.js) to call signOut(auth)
// without needing to import modules directly.
window.auth = auth;
window.db = db;
window.storage = storage;
window.signOut = signOut;
window.collection = collection;
window.doc = doc;
window.setDoc = setDoc;
window.getDocs = getDocs;
window.getDoc = getDoc;
window.query = query;
window.where = where;
window.orderBy = orderBy;
window.serverTimestamp = serverTimestamp;
