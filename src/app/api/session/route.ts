import { NextResponse } from "next/server";

import { getAuthedUser } from "@/lib/auth";

export async function GET() {
  const user = await getAuthedUser();
  return NextResponse.json({ user });
}
