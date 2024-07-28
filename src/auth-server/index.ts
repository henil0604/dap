import { Hono } from "hono";
import { google } from "googleapis";
import { serve as ServeApp, ServerType } from "@hono/node-server";
import { env } from "@/utils/env";
import { CONST } from "@/const";
import { store } from "@/utils/store";

const GOOGLE_CLIENT_ID = env.get(CONST.ENV.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = env.get(CONST.ENV.GOOGLE_CLIENT_SECRET);
const GOOGLE_REDIRECT_URI = env.get(CONST.ENV.GOOGLE_REDIRECT_URI);

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

export const AuthApp = new Hono().basePath("/auth");

AuthApp.get("/", (c) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "openid",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  });
  return c.redirect(authUrl);
});

AuthApp.get("/callback", async (c) => {
  const code = c.req.query("code");

  if (!code) {
    return c.text("Error: No code provided", 400);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // You have the refresh token here
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return c.text("Error: No refresh token obtained", 400);
    }

    store.setItem("refreshToken", refreshToken);

    return c.json({
      message: "Google OAuth successful",
    });
  } catch (error) {
    console.error(error);
    return c.text("Error during OAuth callback", 500);
  }
});

export function serve(port = env.getInt(CONST.ENV.AUTH_SEVER_PORT)) {
  return new Promise<{
    server: ServerType;
    port: number;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = ServeApp({
      fetch: AuthApp.fetch,
      port,
    });

    async function close() {
      return new Promise<void>((resolve) => {
        server.once("close", resolve);
        server.close();
      });
    }

    server.once("listening", () => {
      return resolve({
        server,
        port,
        close,
      });
    });
  });
}

export default AuthApp;
