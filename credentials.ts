import type { App } from "obsidian";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

const STORAGE_KEY = "threads-google-desktop-client";

export function saveGoogleClient(
  app: App,
  clientId: string,
  clientSecret: string
): void {
  const credentials: GoogleClient = {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim()
  };

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error("Enter both the Client ID and Client secret.");
  }

  app.secretStorage.setSecret(
    STORAGE_KEY,
    JSON.stringify(credentials)
  );
}

export function readGoogleClient(app: App): GoogleClient | null {
  const stored = app.secretStorage.getSecret(STORAGE_KEY);
  if (!stored) return null;

  try {
    const value = JSON.parse(stored) as Partial<GoogleClient> | null;

    if (
      typeof value?.clientId !== "string" ||
      typeof value?.clientSecret !== "string"
    ) {
      return null;
    }

    return {
      clientId: value.clientId,
      clientSecret: value.clientSecret
    };
  } catch {
    return null;
  }
}