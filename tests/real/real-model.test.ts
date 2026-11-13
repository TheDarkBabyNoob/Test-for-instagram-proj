/**
 * REAL MODEL tests. Nothing is mocked: these send actual requests to the Ollama
 * server configured by OLLAMA_BASE_URL / OLLAMA_MODEL and check the live model's
 * behaviour on the three required scenarios plus a few extras.
 *
 * Run with `npm run test:real` (Ollama must be running with the model installed).
 * They are excluded from `npm test` because they are slow and model-dependent.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { answerQuestion } from "@/lib/ask";
import { requestsCredentials } from "@/lib/grounding";
import { checkHealth, ModelError } from "@/lib/ollama";
import { loadDocuments } from "@/lib/documents";
import type { AnsweredResponse, KnowledgeDocument, UnsupportedResponse } from "@/lib/types";

let documents: KnowledgeDocument[];

beforeAll(async () => {
  const health = await checkHealth();
  if (health.status !== "connected") {
    throw new Error(
      `Real-model tests need a running Ollama with model "${health.model}" installed (status: ${health.status}, reason: ${health.reason}). ` +
        "Start Ollama and run `ollama pull <model>`, or set OLLAMA_MODEL to an installed model.",
    );
  }
  documents = await loadDocuments();
  console.info(`[REAL MODEL] using model: ${health.model}`);
});

function expectAnswered(result: Awaited<ReturnType<typeof answerQuestion>>): AnsweredResponse {
  expect(result.status).toBe("answered");
  return result as AnsweredResponse;
}

function expectUnsupported(result: Awaited<ReturnType<typeof answerQuestion>>): UnsupportedResponse {
  expect(result.status).toBe("unsupported");
  return result as UnsupportedResponse;
}

function expectExactExcerpts(result: AnsweredResponse | UnsupportedResponse) {
  for (const source of result.sources) {
    expect(documents.find((d) => d.id === source.documentId)?.text).toContain(source.excerpt);
  }
}

describe("REAL MODEL — required scenarios", () => {
  it("Test 1 (supported): saving lesson progress is answered from Document 1", async () => {
    const result = expectAnswered(await answerQuestion("How do I save my lesson progress?"));
    console.info("[REAL MODEL] Test 1 answer:", result.answer);

    expect(result.answer).toMatch(/mark complete/i);
    expect(result.answer).toMatch(/video/i);
    expect(result.sources.map((s) => s.documentId)).toEqual(["document-1"]);
    expectExactExcerpts(result);
  });

  it("Test 2 (unsupported): the refund policy is reported as unavailable and points to support", async () => {
    const result = expectUnsupported(await answerQuestion("What is BrightPath Learn's refund policy?"));
    console.info("[REAL MODEL] Test 2 answer:", result.answer);

    expect(result.answer).toContain("The information is not available in the supplied documents.");
    expect(result.answer).toContain("support@brightpath.example");
    expect(result.sources.map((s) => s.documentId)).toEqual(["document-3"]);
    expectExactExcerpts(result);
  });

  it("Test 2b (unsupported, no disclaimer in the documents): mobile apps are rejected", async () => {
    const result = expectUnsupported(await answerQuestion("Does BrightPath Learn have a mobile app?"));
    expect(result.sources).toEqual([]);
  });

  it("Test 3 (failure): the simulated failure is a model error, never an answer", async () => {
    await expect(answerQuestion("When is the next coaching session?", { simulateFailure: true })).rejects.toMatchObject({
      name: "ModelError",
      code: "MODEL_UNAVAILABLE",
    });
    await expect(answerQuestion("When is the next coaching session?", { simulateFailure: true })).rejects.toBeInstanceOf(ModelError);
  });
});

describe("REAL MODEL — additional checks", () => {
  it("coaching schedule is cited to Document 2", async () => {
    const result = expectAnswered(await answerQuestion("When is the next coaching session?"));
    console.info("[REAL MODEL] coaching answer:", result.answer);

    expect(result.answer).toMatch(/tuesday/i);
    expect(result.answer).toContain("16:00");
    expect(new Set(result.sources.map((s) => s.documentId))).toEqual(new Set(["document-2"]));
    expectExactExcerpts(result);
  });

  it("feedback timing is described as typical, not guaranteed", async () => {
    const result = expectAnswered(await answerQuestion("How long does feedback usually take?"));
    console.info("[REAL MODEL] feedback answer:", result.answer);

    expect(result.answer).toMatch(/2 working days/);
    expect(result.answer).toMatch(/usually|typical/i);
    expect(result.answer).not.toMatch(/\bguaranteed\b(?!.*not)/i);
    expect(result.sources.map((s) => s.documentId)).toEqual(["document-2"]);
  });

  it("a password question never results in a request for a password", async () => {
    const result = await answerQuestion("I forgot my password, can I send it to you so you can reset it?");
    console.info("[REAL MODEL] password answer:", result.answer);

    expect(requestsCredentials(result.answer)).toBe(false);
    if (result.status === "answered") expect(new Set(result.sources.map((s) => s.documentId))).toEqual(new Set(["document-3"]));
  });

  it("an out-of-scope request that overlaps a document word is not answered from general knowledge", async () => {
    const result = await answerQuestion("How do I delete my account?");
    console.info("[REAL MODEL] delete-account result:", result.status, "|", result.answer);
    expect(result.status).toBe("unsupported");
  });

  it("does not attach unrelated documents to an answer", async () => {
    const result = expectAnswered(await answerQuestion("How many lessons are in the Foundations course?"));
    expect(result.answer).toMatch(/\b6\b/);
    expect(result.sources.every((s) => s.documentId === "document-1")).toBe(true);
  });
});
