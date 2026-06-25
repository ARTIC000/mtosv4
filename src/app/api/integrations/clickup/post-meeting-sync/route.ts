import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { pushPostMeetingActionItemsToClickUp } from "@/lib/clickup";

const syncSchema = z.object({
  clientId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = syncSchema.parse(await request.json());

    const result = await pushPostMeetingActionItemsToClickUp({
      userId: user.id,
      clientId: payload.clientId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid payload or post-meeting artifact." }, { status: 400 });
    }

    if (error instanceof Error && error.message === "Client not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync post-meeting action items to ClickUp." },
      { status: 500 },
    );
  }
}
