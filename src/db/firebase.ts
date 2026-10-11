import { initializeApp, cert, getApps } from "firebase-admin/app";
import { config } from "../config.js";

/**
 * Initialise the default firebase-admin app exactly once. Typesaurus' admin
 * adapter lazily resolves the default app via `getApp()`, so this must run
 * before any Firestore operation (entrypoint + standalone scripts call it).
 */
export function initFirebase(): void {
  if (getApps().length === 0) {
    initializeApp({ credential: cert(config.serviceAccount) });
  }
}
