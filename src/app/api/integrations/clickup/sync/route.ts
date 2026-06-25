import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { persistSyncedClients } from "@/lib/clickup";

const syncSchema = z.object({
  selectedIds: z.array(z.string().min(1)).default([]),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = syncSchema.parse(await request.json());

    const result = await persistSyncedClients({
      userId: user.id,
      selectedIds: payload.selectedIds,
      managerName: user.name,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid payload." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync clients." },
      { status: 500 },
    );
  }
}
