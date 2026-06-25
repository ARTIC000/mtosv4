import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deleteManualConnectorToken,
  getManualConnectorConfig,
  isAdminManualConnectorTarget,
  upsertManualConnectorToken,
} from "@/lib/manual-connectors";

const manualTokenSchema = z.object({
  target: z.enum(["ghl", "ahrefs", "meta"]),
  accessToken: z.string().trim().min(1, "Access token is required."),
  refreshToken: z.string().trim().optional(),
  accountEmail: z.string().trim().optional(),
  workspaceName: z.string().trim().optional(),
  scope: z.string().trim().optional(),
  expiresIn: z
    .union([z.number().int().positive(), z.string().trim().regex(/^\d+$/, "Expires in must be a positive number.")])
    .optional(),
});

const disconnectSchema = z.object({
  target: z.enum(["ghl", "ahrefs", "meta"]),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = manualTokenSchema.parse(await request.json());

    if (isAdminManualConnectorTarget(payload.target) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can connect this integration." }, { status: 403 });
    }

    const config = getManualConnectorConfig(payload.target);

    await upsertManualConnectorToken({
      userId: user.id,
      target: payload.target,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      accountEmail: payload.accountEmail,
      workspaceName: payload.workspaceName,
      scope: payload.scope,
      expiresIn:
        typeof payload.expiresIn === "string"
          ? Number.parseInt(payload.expiresIn, 10)
          : payload.expiresIn,
      metadata: {
        connectionMethod: "manual_token",
        connectedAt: new Date().toISOString(),
        label: config.label,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid token payload." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to connect integration." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const payload = disconnectSchema.parse(await request.json());

    if (isAdminManualConnectorTarget(payload.target) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can disconnect this integration." }, { status: 403 });
    }

    await deleteManualConnectorToken(user.id, payload.target);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid integration target." }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to disconnect integration." }, { status: 500 });
  }
}
