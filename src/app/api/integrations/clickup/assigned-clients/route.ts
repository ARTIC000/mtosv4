import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getAssignedTrackerRows } from "@/lib/clickup";

export async function GET() {
  try {
    const user = await requireUser();
    const clients = await getAssignedTrackerRows(user.id, user.name);

    return NextResponse.json({
      managerName: user.name,
      clients,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load your assigned accounts." },
      { status: 500 },
    );
  }
}
