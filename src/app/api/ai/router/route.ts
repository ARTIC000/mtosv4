import { NextResponse } from "next/server";
import { z } from "zod";

import { persistAiArtifact } from "@/lib/ai-artifacts";
import { requireUser } from "@/lib/auth";
import { executeRoutedPrompt, getAiExecutionStatus } from "@/lib/ai-execution";
import { AI_TASK_TYPES, aiRouterRequestSchema, buildAiRouterPayload } from "@/lib/ai-router";
import { MASTER_PROMPT_FILE_PATH, getMasterPrompt } from "@/lib/master-prompt";

export async function GET() {
  try {
    const user = await requireUser();
    const masterPrompt = await getMasterPrompt();

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      router: {
        status: "ready",
        executionMode: "packaging-and-optional-execution",
        supportedTaskTypes: AI_TASK_TYPES,
      },
      execution: getAiExecutionStatus(),
      masterPrompt: {
        sourceFilePath: MASTER_PROMPT_FILE_PATH,
        length: masterPrompt.length,
        loaded: true,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ error: "Unable to load AI router status." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = aiRouterRequestSchema.parse(await request.json());
    const result = await buildAiRouterPayload({
      user,
      request: payload,
    });

    if (!payload.execute) {
      return NextResponse.json(result);
    }

    const execution = await executeRoutedPrompt({
      payload: result,
      maxTokens: payload.maxTokens,
      temperature: payload.temperature,
    });

    const savedArtifact =
      payload.artifactType && payload.clientId
        ? await persistAiArtifact({
            userId: user.id,
            clientId: payload.clientId,
            type: payload.artifactType,
            title: payload.artifactTitle || payload.task,
            taskType: result.router.taskType,
            routerModel: result.router.model,
            phase: result.router.phase,
            promptTask: payload.task,
            execution,
          })
        : null;

    return NextResponse.json({
      ...result,
      execution: {
        ...execution,
        executed: true,
      },
      savedArtifact: savedArtifact
        ? {
            id: savedArtifact.id,
            type: savedArtifact.type,
            updatedAt: savedArtifact.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid AI router payload." }, { status: 400 });
    }

    if (error instanceof Error && error.message === "CLIENT_NOT_FOUND") {
      return NextResponse.json({ error: "Client not found in your synced MTOS roster." }, { status: 404 });
    }

    if (error instanceof Error && error.message === "GEMINI_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "Gemini execution is not configured. Add GEMINI_API_KEY or GOOGLE_API_KEY to the environment." },
        { status: 503 },
      );
    }

    if (error instanceof Error && error.message === "CLAUDE_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "Claude execution is not configured. Add ANTHROPIC_API_KEY to the environment." },
        { status: 503 },
      );
    }

    if (error instanceof Error && error.message.startsWith("GEMINI_ERROR:")) {
      return NextResponse.json(
        { error: "Gemini execution failed.", details: error.message.slice("GEMINI_ERROR:".length) },
        { status: 502 },
      );
    }

    if (error instanceof Error && error.message.startsWith("CLAUDE_ERROR:")) {
      return NextResponse.json(
        { error: "Claude execution failed.", details: error.message.slice("CLAUDE_ERROR:".length) },
        { status: 502 },
      );
    }

    return NextResponse.json({ error: "Unable to build AI router payload." }, { status: 500 });
  }
}
