import { answerQuestion } from "@/lib/ask";
import { MAX_QUESTION_LENGTH, testingToolsEnabled } from "@/lib/config";
import { ModelError } from "@/lib/ollama";
import type { AskResponse, ErrorCode, ErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** User-safe messages. Internal details (URLs, stack traces) never reach the client. */
const MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: "Please enter a question (up to 500 characters).",
  MODEL_UNAVAILABLE: "The AI model is currently unavailable.",
  MODEL_NOT_FOUND: "The configured AI model is not installed.",
  MODEL_TIMEOUT: "The AI model took too long to respond.",
  MODEL_BAD_RESPONSE: "The AI model returned an unexpected response.",
  INTERNAL_ERROR: "Something went wrong while answering your question.",
};

const STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  MODEL_UNAVAILABLE: 503,
  MODEL_NOT_FOUND: 503,
  MODEL_TIMEOUT: 504,
  MODEL_BAD_RESPONSE: 502,
  INTERNAL_ERROR: 500,
};

function json(body: AskResponse, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(code: ErrorCode, message = MESSAGES[code]): Response {
  const body: ErrorResponse = { status: "error", code, message };
  return json(body, STATUS[code]);
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST");
  }

  const { question, simulateFailure } = (payload ?? {}) as {
    question?: unknown;
    simulateFailure?: unknown;
  };
  if (typeof question !== "string") return errorResponse("INVALID_REQUEST");

  const trimmed = question.trim();
  if (trimmed.length === 0) return errorResponse("INVALID_REQUEST", "Please enter a question.");
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return errorResponse(
      "INVALID_REQUEST",
      `Please keep your question under ${MAX_QUESTION_LENGTH} characters.`,
    );
  }

  try {
    const result = await answerQuestion(trimmed, {
      // The failure switch is ignored unless testing tools are enabled (dev, or ENABLE_TESTING_TOOLS=true).
      simulateFailure: simulateFailure === true && testingToolsEnabled(),
    });
    return json(result);
  } catch (error) {
    if (error instanceof ModelError) {
      console.error(`[api/ask] ${error.code}: ${error.message}`);
      return errorResponse(error.code);
    }
    console.error("[api/ask] unexpected error", error instanceof Error ? error.name : typeof error);
    return errorResponse("INTERNAL_ERROR");
  }
}
