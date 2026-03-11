import open from "open";
import { createAuthClientForEnv, resolveServer } from "../auth";
import { setTokenForEnv, upsertEnvironment, type EnvName } from "../config";

export interface LoginCommandOptions {
  hostname: string;
  token?: string;
}

export async function loginCommand(options: LoginCommandOptions): Promise<void> {
  try {
    const { host: envName, baseURL } = resolveServer(options.hostname);

    if (options.token) {
      console.log("🔐 Token exchange...");
      console.log(`🌐 Server: ${baseURL}`);

      const resp = await fetch(`${baseURL}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: options.token }),
      });

      const responseText = await resp.text();

      if (!resp.ok) {
        // Try to extract a clean error message from JSON, fall back to raw text
        let errorMessage = responseText;
        try {
          const errorJson = JSON.parse(responseText) as { error?: string; message?: string };
          errorMessage = errorJson.error ?? errorJson.message ?? responseText;
        } catch {
          // Not JSON — show HTTP status + truncated body
          errorMessage = `HTTP ${resp.status} ${resp.statusText}`;
          if (responseText && responseText.length < 200) errorMessage += `: ${responseText}`;
        }
        console.error("❌ Token exchange failed:", errorMessage);
        process.exit(1);
      }

      let parsed: { token: string; user: { id: string; email: string; name: string } };
      try {
        parsed = JSON.parse(responseText) as typeof parsed;
      } catch {
        console.error("❌ Token exchange failed: server returned unexpected response (not JSON)");
        console.error("   Response:", responseText.slice(0, 200));
        process.exit(1);
      }
      const { token, user } = parsed;

      await setTokenForEnv(envName, user.email, token);
      upsertEnvironment({
        name: envName,
        baseURL,
        user: { id: user.id, email: user.email, name: user.name },
        lastLoginTime: new Date().toISOString(),
      });

      console.log(`✅ Logged in as ${user.name} (${user.email})`);
      console.log(`🌐 Environment: ${envName}`);
      process.exit(0);
    }

    console.log("🔐 AgentLogs Device Authorization");
    console.log(`🌐 Server: ${baseURL}`);
    console.log("⏳ Requesting device authorization...");

    const authClient = createAuthClientForEnv(baseURL);

    // Request device code
    const { data, error } = await authClient.device.code({
      client_id: "agentlogs-cli",
      scope: "openid profile email",
    });

    if (error || !data) {
      console.error("❌ Error:", error?.error_description || "Failed to request device code");
      process.exit(1);
    }

    const { device_code, user_code, verification_uri, verification_uri_complete, interval = 5 } = data;

    console.log("\n📱 Device Authorization in Progress");
    console.log(`Please visit: ${verification_uri}`);
    console.log(`Enter code: ${user_code}\n`);

    // Open browser with the complete URL
    const urlToOpen = verification_uri_complete || verification_uri;
    const isHeadless = !process.stdout.isTTY || !!process.env.CI;

    if (urlToOpen) {
      if (isHeadless) {
        console.log("🖥️  Headless environment detected — open this URL in your browser:");
        console.log(`\n  ${urlToOpen}\n`);
      } else {
        console.log("🌐 Opening browser...");
        await open(urlToOpen);
      }
    }

    console.log(`⏳ Waiting for authorization... (polling every ${interval}s)`);

    // Poll for token
    await pollForToken(authClient, device_code, interval, envName, baseURL);
  } catch (err) {
    console.error("❌ Error:", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  }
}

async function pollForToken(
  authClient: ReturnType<typeof createAuthClientForEnv>,
  deviceCode: string,
  interval: number,
  envName: EnvName,
  baseURL: string,
): Promise<void> {
  let pollingInterval = interval;

  return new Promise<void>((resolve) => {
    const poll = async () => {
      try {
        const { data, error } = await authClient.device.token({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: "agentlogs-cli",
        });

        if (data?.access_token) {
          console.log("\n✅ Authorization Successful!");
          console.log("🔑 Access token received!");

          // Get user session with Bearer token
          const { data: session } = await authClient.getSession({
            fetchOptions: {
              headers: {
                Authorization: `Bearer ${data.access_token}`,
              },
            },
          });

          if (session?.user) {
            // Store token in local store for this environment
            await setTokenForEnv(envName, session.user.email, data.access_token);

            // Store environment info in config
            upsertEnvironment({
              name: envName,
              baseURL,
              user: {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
              },
              lastLoginTime: new Date().toISOString(),
            });

            console.log(`👋 Hello, ${session.user.name}!`);
            console.log(`📧 Logged in as: ${session.user.email}`);
            console.log(`🌐 Environment: ${envName}`);
          } else {
            console.log("⚠️  Warning: Could not retrieve user session");
          }

          resolve();
          process.exit(0);
        } else if (error) {
          switch (error.error) {
            case "authorization_pending":
              // Continue polling silently
              break;
            case "slow_down":
              pollingInterval += 5;
              console.log(`⚠️  Slowing down polling to ${pollingInterval}s`);
              break;
            case "access_denied":
              console.error("❌ Access was denied by the user");
              process.exit(1);
              break;
            case "expired_token":
              console.error("❌ The device code has expired. Please try again.");
              process.exit(1);
              break;
            default:
              console.error("❌ Error:", error.error_description || error.error);
              process.exit(1);
          }
        }
      } catch (err) {
        console.error("❌ Error:", err instanceof Error ? err.message : "Unknown error");
        process.exit(1);
      }

      // Schedule next poll
      setTimeout(poll, pollingInterval * 1000);
    };

    // Start polling
    setTimeout(poll, pollingInterval * 1000);
  });
}
