import type { AiRouterPayload } from "@/lib/ai-router";

type ProviderName = "gemini" | "claude";

type ExecuteRoutedPromptArgs = {
  payload: AiRouterPayload;
  maxTokens?: number | null;
  temperature?: number | null;
};

export type ExecutedAiResult = {
  provider: ProviderName;
  model: string;
  outputText: string;
  stopReason: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  "sonnet 4": "claude-sonnet-4-6",
  "sonnet 4.6": "claude-sonnet-4-6",
  "claude sonnet 4": "claude-sonnet-4-6",
  "claude sonnet 4.6": "claude-sonnet-4-6",
  "claude-4-sonnet": "claude-sonnet-4-6",
  "claude-4.6-sonnet": "claude-sonnet-4-6",
  "claude-3-5-sonnet-latest": "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-latest": "claude-3-5-haiku-20241022",
  "claude-3-opus-latest": "claude-3-opus-20240229",
  "claude-3-sonnet-latest": "claude-3-sonnet-20240229",
  "claude-3-haiku-latest": "claude-3-haiku-20240307",
};

function resolveClaudeModel(model: string) {
  return CLAUDE_MODEL_ALIASES[model] || model;
}

function getProviderConfig(provider: ProviderName) {
  if (provider === "gemini") {
    return {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
      model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
    };
  }

  return {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: resolveClaudeModel(process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"),
  };
}

export function getAiExecutionStatus() {
  const gemini = getProviderConfig("gemini");
  const claude = getProviderConfig("claude");

  return {
    gemini: {
      configured: Boolean(gemini.apiKey),
      model: gemini.model,
    },
    claude: {
      configured: Boolean(claude.apiKey),
      model: claude.model,
    },
  };
}

function buildSystemPrompt(payload: AiRouterPayload) {
  return [
    payload.promptPackage.masterPrompt,
    ...payload.promptPackage.runtimeInstructions,
    ...payload.promptPackage.artifactInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildUserPrompt(payload: AiRouterPayload) {
  return [
    "MTOS task request:",
    payload.promptPackage.userPrompt,
    "",
    "Intelligence package JSON:",
    JSON.stringify(payload.intelligencePackage, null, 2),
  ].join("\n");
}

async function executeGemini(args: ExecuteRoutedPromptArgs): Promise<ExecutedAiResult> {
  const config = getProviderConfig("gemini");
  if (!config.apiKey) {
    throw new Error("GEMINI_NOT_CONFIGURED");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemPrompt(args.payload) }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildUserPrompt(args.payload) }],
          },
        ],
        generationConfig: {
          temperature: args.temperature ?? args.payload.intelligencePackage.request.temperature ?? 0.2,
          maxOutputTokens: args.maxTokens ?? args.payload.intelligencePackage.request.maxTokens ?? 2048,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`GEMINI_ERROR:${await response.text()}`);
  }

  const result = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const outputText =
    result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || "";

  return {
    provider: "gemini",
    model: config.model,
    outputText,
    stopReason: result.candidates?.[0]?.finishReason || null,
    usage: {
      inputTokens: result.usageMetadata?.promptTokenCount ?? null,
      outputTokens: result.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

async function executeClaude(args: ExecuteRoutedPromptArgs): Promise<ExecutedAiResult> {
  const config = getProviderConfig("claude");
  if (!config.apiKey) {
    throw new Error("CLAUDE_NOT_CONFIGURED");
  }

  const candidates = Array.from(
    new Set([
      config.model,
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ]),
  );

  const basePayload = {
    system: buildSystemPrompt(args.payload),
    max_tokens: args.maxTokens ?? args.payload.intelligencePackage.request.maxTokens ?? 2048,
    temperature: args.temperature ?? args.payload.intelligencePackage.request.temperature ?? 0.2,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildUserPrompt(args.payload),
          },
        ],
      },
    ],
  };

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": "2023-06-01",
  };

  let lastErrorText = "";

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index]!;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        ...basePayload,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      lastErrorText = text;
      try {
        const parsed = JSON.parse(text) as { type?: string; error?: { type?: string } };
        if (parsed?.error?.type === "not_found_error" && index < candidates.length - 1) {
          continue;
        }
      } catch {
        if (index < candidates.length - 1) {
          continue;
        }
      }

      throw new Error(`CLAUDE_ERROR:${text}`);
    }

    const result = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };

    const outputText =
      result.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text || "")
        .join("\n")
        .trim() || "";

    return {
      provider: "claude",
      model,
      outputText,
      stopReason: result.stop_reason || null,
      usage: {
        inputTokens: result.usage?.input_tokens ?? null,
        outputTokens: result.usage?.output_tokens ?? null,
      },
    };
  }

  throw new Error(`CLAUDE_ERROR:${lastErrorText || "Unable to execute Claude request."}`);
}

export async function executeRoutedPrompt(args: ExecuteRoutedPromptArgs) {
  if (args.payload.router.model === "gemini") {
    return executeGemini(args);
  }

  return executeClaude(args);
}
