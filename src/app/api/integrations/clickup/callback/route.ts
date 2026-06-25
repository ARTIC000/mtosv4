import { NextResponse } from "next/server";

import { exchangeClickUpCode, getClickUpTeams, upsertClickUpToken } from "@/lib/clickup";
import { verifyOAuthState } from "@/lib/oauth-state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const appUrl = process.env.APP_URL || "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(`${appUrl}/?screen=integrations&error=${encodeURIComponent("ClickUp authorization was denied.")}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/?screen=integrations&error=${encodeURIComponent("ClickUp callback was incomplete.")}`);
  }

  try {
    const oauthState = await verifyOAuthState<{
      userId: string;
      email: string;
    }>(state);

    const token = await exchangeClickUpCode(code);
    const teams = await getClickUpTeams(token.access_token);
    const primaryTeam = teams[0];

    await upsertClickUpToken({
      userId: oauthState.userId,
      accountEmail: oauthState.email,
      workspaceId: primaryTeam?.id,
      workspaceName: primaryTeam?.name,
      accessToken: token.access_token,
      metadata: {
        tokenType: token.token_type || "bearer",
        teams,
      },
    });

    return NextResponse.redirect(
      `${appUrl}/?screen=integrations&toast=${encodeURIComponent("ClickUp connected. You can sync your assigned clients now.")}`,
    );
  } catch (callbackError) {
    return NextResponse.redirect(
      `${appUrl}/?screen=integrations&error=${encodeURIComponent(
        callbackError instanceof Error ? callbackError.message : "ClickUp callback failed.",
      )}`,
    );
  }
}
