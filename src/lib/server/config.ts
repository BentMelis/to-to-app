/**
 * Server configuration (see .env.example). Accounts & sync switch on only when MongoDB and the Firebase project are
 * set, so an environment without them keeps working as the local-only app.
 *
 * No Firebase service account key is needed: checking a sign-in (an ID token) only needs the project id, because
 * the token is verified against Google's public keys. Deleting the sign-in account happens in the browser.
 */
export function serverConfig() {
  return {
    mongoUri: process.env.MONGODB_URI?.trim() || '',
    mongoDb: process.env.MONGODB_DB?.trim() || 'twiglist',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || '',
  };
}

export function cloudConfigured() {
  const c = serverConfig();
  return !!c.mongoUri && !!c.projectId;
}
