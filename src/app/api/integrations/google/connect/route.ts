import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { buildGoogleAuthUrl, deleteGoogleToken, type GoogleTarget } from "@/lib/google";
import { signOAuthState } from "@/lib/oauth-state";

const connectSchema = z.object({
  target: z.enum(["gcalendar", "gdrive", "gmail", "meet", "mcc", "adg"]),
});

function isAdminTarget(target: GoogleTarget) {
  return target === "mcc" || target === "adg";
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = connectSchema.parse(await request.json());

    if (isAdminTarget(payload.target) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can connect this Google source." }, { status: 403 });
    }

    const state = await signOAuthState({
      userId: user.id,
      email: user.email,
      target: payload.target,
    });

    return NextResponse.json({
      authUrl: buildGoogleAuthUrl(payload.target, state),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid Google target." }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to start Google authorization." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const payload = connectSchema.parse(await request.json());

    if (isAdminTarget(payload.target) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can disconnect this Google source." }, { status: 403 });
    }

    await deleteGoogleToken(user.id, payload.target);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid Google target." }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to disconnect Google integration." }, { status: 500 });
  }
}
