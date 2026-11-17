import { createServer } from "node:http";
import { createGoogleLogin } from "./oauth";

export function waitForGoogleCode(
  clientId: string,
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Sign-in cancelled."));
      return;
    }

    let login: ReturnType<typeof createGoogleLogin> | undefined;
    let redirectUri = "";
    let finished = false;
    const server = createServer();

    const finish = (error?: Error, code?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else resolve({ code: code!, verifier: login!.verifier, redirectUri });
    };

    const cancel = () => finish(new Error("Sign-in cancelled."));
    const timer = setTimeout(
      () => finish(new Error("Sign-in timed out. Try again.")), 180000
    );
    signal.addEventListener("abort", cancel, { once: true });

    server.on("request", (req, res) => {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      let url: URL;
      try { url = new URL(req.url ?? "/", "http://127.0.0.1"); }
      catch { res.writeHead(400).end("Invalid request."); return; }
      if (req.method !== "GET" || url.pathname !== "/oauth/callback") {
        res.writeHead(404).end("Not found."); return;
      }
      if (!login || url.searchParams.get("state") !== login.state) {
        res.writeHead(400).end("Invalid sign-in state."); return;
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.has("error") || !code) {
        res.end("Sign-in unsuccessful. Return to Obsidian.", () =>
          finish(new Error("Google sign-in was not completed.")));
        return;
      }
      res.end("Response received. Return to Obsidian.", () => finish(undefined, code));
    });

    server.on("error", () => finish(new Error("Could not start sign-in listener.")));
    server.listen(0, "127.0.0.1", () => {
      if (finished) { server.close(); return; }
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(new Error("Could not determine callback address.")); return;
      }
      redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      login = createGoogleLogin(clientId, redirectUri);
      void openBrowser(login.authorizationUrl).catch(() =>
        finish(new Error("Could not open your browser.")));
    });
  });
}