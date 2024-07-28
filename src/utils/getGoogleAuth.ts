import { google } from "googleapis";
import { env } from "@/utils/env";
import { CONST } from "@/const";

export function getGoogleAuth(refreshToken: string) {
  const auth = new google.auth.OAuth2({
    clientId: env.get(CONST.ENV.GOOGLE_CLIENT_ID),
    clientSecret: env.get(CONST.ENV.GOOGLE_CLIENT_SECRET),
  });

  auth.setCredentials({
    refresh_token: refreshToken,
  });

  return auth;
}
