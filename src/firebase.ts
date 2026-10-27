import { initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const env = import.meta.env
export const firebaseConfigured = [
  env.VITE_FIREBASE_API_KEY,
  env.VITE_FIREBASE_AUTH_DOMAIN,
  env.VITE_FIREBASE_PROJECT_ID,
  env.VITE_FIREBASE_APP_ID,
].every(Boolean)
const app = firebaseConfigured
  ? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  : null
export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
// Explicitly opt-in for local integration tests. A production build always uses live Firebase.
if (import.meta.env.DEV && env.VITE_FIREBASE_EMULATORS === '1' && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8085)
}
export async function login() {
  if (!auth)
    throw Error('Cloud sync needs Firebase configuration. See the setup guide in this repository.')
  await signInWithPopup(auth, new GoogleAuthProvider())
}
export async function logout() {
  if (auth) await signOut(auth)
}
