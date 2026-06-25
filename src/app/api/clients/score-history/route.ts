import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId") || "";
    const limitValue = url.searchParams.get("limit") || "30";
    const limit = Math.max(1, Math.min(200, Number(limitValue)));

    if (!clientId) {
      return NextResponse.json({ error: "Missing clientId." }, { status: 400 });
    }

    const rows = await prisma.mtosScoreSnapshot.findMany({
      where: {
        userId: user.id,
        clientId,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      clientId,
      snapshots: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        health: row.health,
        risk: row.risk,
        upsellReadiness: row.upsellReadiness,
        factors: row.factors || null,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ error: "Unable to load MTOS score history." }, { status: 500 });
  }
}

