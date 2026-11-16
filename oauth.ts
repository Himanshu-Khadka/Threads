import { createHash, randomBytes } from "node:crypto";

export function createGoogleLogin(
  clientId: string,
  redirectUri: string
) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");

  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const parameters = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  const authorizationUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`;

  return { authorizationUrl, state, verifier };
}