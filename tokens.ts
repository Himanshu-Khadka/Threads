import { requestUrl } from "obsidian";
import type { GoogleClient } from "./credentials";

export async function exchangeGoogleCode(
  client: GoogleClient,
  login: { code: string; verifier: string; redirectUri: string }
) {
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: login.code,
    code_verifier: login.verifier,
    redirect_uri: login.redirectUri,
    grant_type: "authorization_code"
  });

  const response = await requestUrl({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    throw: false
  }).catch(() => {
    throw new Error("Could not reach Google. Check your connection.");
  });

  if (response.status !== 200) {
    throw new Error(
      `Google rejected the token exchange (HTTP ${response.status}). Sign in again.`
    );
  }

  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(response.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    data = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Google returned an unreadable token response.");
  }

  if (
    typeof data.access_token !== "string" || !data.access_token ||
    typeof data.refresh_token !== "string" || !data.refresh_token ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
    data.token_type !== "Bearer"
  ) {
    throw new Error("Google did not return the required tokens. Sign in again.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}