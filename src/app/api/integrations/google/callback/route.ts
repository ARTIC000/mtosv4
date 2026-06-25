import { NextResponse } from "next/server";

import { exchangeGoogleCode, getGoogleUserInfo, upsertGoogleToken, type GoogleTarget } from "@/lib/google";
import { verifyOAuthState } from "@/lib/oauth-state";

function isGoogleTarget(value: string): value is GoogleTarget {
  return value === "gcalendar" || value === "gdrive" || value === "gmail" || value === "meet" || value === "mcc" || value === "adg";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    return NextResponse.redirect(`${appUrl}/?screen=integrations&error=${encodeURIComponent("Google authorization was denied.")}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/?screen=integrations&error=${encodeURIComponent("Google callback was incomplete.")}`);
  }

  try {
    const oauthState = await verifyOAuthState<{
      userId: string;
      email: string;
      target: string;
    }>(state);

    if (!isGoogleTarget(oauthState.target)) {
      throw new Error("Unsupported Google integration target.");
    }

    const token = await exchangeGoogleCode(code);
    const profile = await getGoogleUserInfo(token.access_token);

    await upsertGoogleToken({
      userId: oauthState.userId,
      target: oauthState.target,
      accountEmail: profile.email || oauthState.email,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      expiresIn: token.expires_in,
      metadata: {
        tokenType: token.token_type || "Bearer",
        idToken: token.id_token || null,
        profileName: profile.name || null,
      },
    });

    return NextResponse.redirect(
      `${appUrl}/?screen=integrations&toast=${encodeURIComponent("Google integration connected successfully.")}`,
    );
  } catch (callbackError) {
    return NextResponse.redirect(
      `${appUrl}/?screen=integrations&error=${encodeURIComponent(
        callbackError instanceof Error ? callbackError.message : "Unable to complete Google authorization.",
      )}`,
    );
  }
}
