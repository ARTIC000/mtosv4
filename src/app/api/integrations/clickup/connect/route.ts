import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { buildClickUpAuthorizeUrl } from "@/lib/clickup";
import { signOAuthState } from "@/lib/oauth-state";
import { prisma } from "@/lib/prisma";

const connectSchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = connectSchema.parse(await request.json());

    const state = await signOAuthState({
      userId: user.id,
      email: payload.email,
    });

    return NextResponse.json({
      authUrl: buildClickUpAuthorizeUrl({ state }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid payload." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to initialize ClickUp OAuth." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await prisma.oAuthToken.deleteMany({
      where: {
        userId: user.id,
        provider: "clickup",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ error: "Unable to disconnect ClickUp." }, { status: 500 });
  }
}
