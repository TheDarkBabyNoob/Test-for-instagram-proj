/**
 * API tests. Every test here MOCKS the HTTP boundary to Ollama (global fetch),
 * so none of them involve a real language model. See tests/real for the
 * live-model tests.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as askPOST } from "@/app/api/ask/route";
import { loadDocuments } from "@/lib/documents";
import type { AskResponse, HealthResponse, KnowledgeDocument } from "@/lib/types";

const OLLAMA_URL = "http://ollama.test:11434";
const fetchMock = vi.fn();

let documents: KnowledgeDocument[];

beforeAll(async () => {
  documents = await loadDocuments();
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OLLAMA_BASE_URL", OLLAMA_URL);
  vi.stubEnv("OLLAMA_MODEL", "qwen2.5:3b");
  vi.stubEnv("OLLAMA_TIMEOUT_MS", "2000");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------------- helpers ------------------------------- */

function ask(body: unknown): Promise<Response> {
  return askPOST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function askJson(body: unknown): Promise<{ status: number; json: AskResponse }> {
  const response = await ask(body);
  return { status: response.status, json: (await response.json()) as AskResponse };
}

/** Wraps a model reply in the envelope Ollama's /api/chat returns. */
function ollamaEnvelope(content: string, status = 200): Response {
  return new Response(JSON.stringify({ model: "qwen2.5:3b", message: { role: "assistant", content }, done: true }), {
    status,
  });
}

/** Finds the passage label ("P1", ...) the app assigned to a passage, from the request it actually sent. */
function labelInPrompt(init: RequestInit, snippet: string): string {
  const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
  const user = body.messages.find((m) => m.role === "user")!.content;
  const match = user.split("\n\n").find((block) => block.includes(snippet));
  const label = match?.match(/^\[(P\d+)\]/)?.[1];
  if (!label) throw new Error(`Prompt contained no passage with "${snippet}"`);
  return label;
}

/** Mocks Ollama replying with a grounded answer that cites the passage containing `citeSnippet`. */
function mockModelAnswer(answer: string, citeSnippet: string) {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
    ollamaEnvelope(
      JSON.stringify({ answerable: true, source_ids: [labelInPrompt(init, citeSnippet)], answer }),
    ),
  );
}

function expectNoLeaks(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const secret of ["ollama.test", "11434", "ECONNREFUSED", "fetch failed", "stack", "node_modules", "    at "]) {
    expect(text).not.toContain(secret);
  }
}

/* ----------------------- Test 1: supported question ----------------------- */

describe("MOCKED model — Test 1: supported question", () => {
  const question = "How do I save my lesson progress?";
  const grounded =
    "To save your lesson progress, select Mark complete after finishing a lesson. Watching a video alone does not mark the lesson complete.";

  it("answers from Document 1 with the exact excerpt", async () => {
    mockModelAnswer(grounded, "Mark complete");

    const { status, json } = await askJson({ question });

    expect(status).toBe(200);
    expect(json.status).toBe("answered");
    if (json.status !== "answered") return;
    expect(json.answer).toContain("Mark complete");
    expect(json.answer).toContain("Watching a video alone does not mark the lesson complete");
    expect(json.sources).toHaveLength(1);
    const [source] = json.sources;
    expect(source.documentId).toBe("document-1");
    expect(source.documentTitle).toBe("Getting started");
    expect(source.excerpt).toBe(
      "To save your progress, select Mark complete after finishing a lesson. Watching a video alone does not mark the lesson complete.",
    );
    // Citation is a verbatim passage of the real file.
    expect(documents[0].text).toContain(source.excerpt);
  });

  it("sends a low-temperature, non-streaming, schema-constrained request to /api/chat with the grounding prompt", async () => {
    mockModelAnswer(grounded, "Mark complete");
    await askJson({ question });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${OLLAMA_URL}/api/chat`);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal); // AbortController timeout is wired up

    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("qwen2.5:3b");
    expect(sent.stream).toBe(false);
    expect(sent.options.temperature).toBeLessThanOrEqual(0.2);
    expect(sent.format.required).toContain("answerable");
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content).toContain("ONLY");
    expect(sent.messages[1].content).toContain("Mark complete");
    expect(sent.messages[1].content).toContain(question);
  });

  it("does not carry over unrelated documents as sources", async () => {
    mockModelAnswer(grounded, "Mark complete");
    const { json } = await askJson({ question });
    expect(json.status === "answered" && json.sources.every((s) => s.documentId === "document-1")).toBe(true);
  });

  it("preserves the 'typical, not a guarantee' caveat for feedback timing", async () => {
    mockModelAnswer(
      "Feedback usually arrives within 2 working days. This is a typical response time, not a guarantee.",
      "Feedback usually arrives",
    );
    const { json } = await askJson({ question: "How long does feedback usually take?" });
    expect(json.status).toBe("answered");
    if (json.status !== "answered") return;
    expect(json.answer).toMatch(/usually/);
    expect(json.answer).toMatch(/not a guarantee/);
    expect(json.sources.map((s) => s.documentId)).toEqual(["document-2"]);
  });

  it("restores caveats a small model leaves out, using only the cited passage's own words", async () => {
    // Shape of the replies observed from qwen2.5:3b: correct, but without the caveat.
    mockModelAnswer("To save your progress, select Mark complete after finishing a lesson.", "Mark complete");
    const progress = await askJson({ question });
    expect(progress.json.status).toBe("answered");
    if (progress.json.status === "answered") {
      expect(progress.json.answer).toContain("Watching a video alone does not mark the lesson complete.");
      expect(progress.json.sources.map((s) => s.documentId)).toEqual(["document-1"]);
    }

    mockModelAnswer("Feedback usually arrives within 2 working days.", "Feedback usually arrives");
    const feedback = await askJson({ question: "How long does feedback usually take?" });
    expect(feedback.json.status).toBe("answered");
    if (feedback.json.status === "answered") {
      expect(feedback.json.answer).toMatch(/usually/);
      expect(feedback.json.answer).toContain("This is a typical response time, not a guarantee.");
    }
  });

  it("cites only real retrieved passages even if the model cites labels it was never given", async () => {
    fetchMock.mockImplementation(async () =>
      ollamaEnvelope(
        JSON.stringify({ answerable: true, source_ids: ["P99", "[P42]"], answer: grounded }),
      ),
    );
    const { json } = await askJson({ question });
    expect(json.status).toBe("answered");
    if (json.status !== "answered") return;
    for (const source of json.sources) expect(documents.find((d) => d.id === source.documentId)?.text).toContain(source.excerpt);
  });
});

/* ---------------------- Test 2: unsupported question ---------------------- */

describe("MOCKED model — Test 2: unsupported question", () => {
  it("abstains on the refund policy, cites Document 3's own statement and refers to support — without calling the model", async () => {
    const { status, json } = await askJson({ question: "What is BrightPath Learn's refund policy?" });

    expect(status).toBe(200);
    expect(json.status).toBe("unsupported");
    if (json.status !== "unsupported") return;
    expect(json.answer).toContain("The information is not available in the supplied documents.");
    expect(json.answer).toContain("refund policy");
    expect(json.answer).toContain("support@brightpath.example");
    expect(json.sources).toHaveLength(1);
    expect(json.sources[0].documentId).toBe("document-3");
    expect(json.sources[0].excerpt).toContain("does not contain pricing, refund rules or job placement promises");
    expect(documents[2].text).toContain(json.sources[0].excerpt);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["How much does the Foundations course cost?", "Will I get a job after finishing the course?"])(
    "abstains and refers to support for: %s",
    async (question) => {
      const { json } = await askJson({ question });
      expect(json.status).toBe("unsupported");
      if (json.status !== "unsupported") return;
      expect(json.answer).toContain("support@brightpath.example");
      expect(json.sources[0]?.documentId).toBe("document-3");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("abstains on a genuinely absent fact (mobile app) with no sources, without calling the model", async () => {
    const { json } = await askJson({ question: "Does BrightPath Learn have a mobile app?" });
    expect(json).toEqual({
      status: "unsupported",
      answer: "The information is not available in the supplied documents.",
      sources: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("abstains when retrieval is weakly related and the model also says it is not answerable", async () => {
    fetchMock.mockImplementation(async () =>
      ollamaEnvelope(JSON.stringify({ answerable: false, source_ids: [], answer: "" })),
    );
    const { json } = await askJson({ question: "How do I save my progress offline?" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // it was relevant enough to ask the model
    expect(json).toEqual({
      status: "unsupported",
      answer: "The information is not available in the supplied documents.",
      sources: [],
    });
  });

  it("does not trust a model that answers with invented details", async () => {
    mockModelAnswer("Feedback arrives within 5 working days and is guaranteed.", "Feedback usually arrives");
    const { json } = await askJson({ question: "How long does feedback usually take?" });
    expect(json.status).toBe("unsupported");
    if (json.status === "unsupported") expect(json.sources).toEqual([]);
  });

  it("never lets an answer ask the member for a password", async () => {
    mockModelAnswer(
      "Please send me your password so I can reset it. Or select Forgot password on the sign-in page.",
      "Forgot password",
    );
    const { json } = await askJson({ question: "I forgot my password" });
    expect(json.status).toBe("unsupported");
    expect(JSON.stringify(json)).not.toMatch(/send me your password/i);
  });

  it("accepts a reset answer that explicitly says not to share the password", async () => {
    mockModelAnswer(
      "To reset your password, select Forgot password on the sign-in page. Never send your password to anyone.",
      "Forgot password",
    );
    const { json } = await askJson({ question: "How do I reset my password?" });
    expect(json.status).toBe("answered");
    if (json.status === "answered") expect(json.sources[0].documentId).toBe("document-3");
  });
});

/* ------------------------- Test 3: API failure ------------------------- */

describe("MOCKED model — Test 3: API failure", () => {
  const question = "When is the next coaching session?";
  const expectedFailure = {
    status: "error",
    code: "MODEL_UNAVAILABLE",
    message: "The AI model is currently unavailable.",
  };

  it("returns a structured error, no answer and no sources when 'Simulate API failure' is on", async () => {
    const { status, json } = await askJson({ question, simulateFailure: true });
    expect(status).toBe(503);
    expect(json).toEqual(expectedFailure);
    expect("answer" in json).toBe(false);
    expect("sources" in json).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails every question while simulating, including ones that would abstain", async () => {
    for (const q of ["What is the refund policy?", "Does BrightPath have a mobile app?"]) {
      const { status, json } = await askJson({ question: q, simulateFailure: true });
      expect(status).toBe(503);
      expect(json).toEqual(expectedFailure);
    }
  });

  it("takes exactly the same error path as a real connection failure", async () => {
    const simulated = await askJson({ question, simulateFailure: true });

    fetchMock.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    const real = await askJson({ question });

    expect(real).toEqual(simulated);
    expectNoLeaks(real);
  });

  it("ignores the failure switch when testing tools are disabled (production without ENABLE_TESTING_TOOLS)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TESTING_TOOLS", "");
    mockModelAnswer("A group coaching session takes place every Tuesday at 16:00 UTC.", "every Tuesday");

    const { status, json } = await askJson({ question, simulateFailure: true });

    expect(status).toBe(200);
    expect(json.status).toBe("answered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours the failure switch in production when ENABLE_TESTING_TOOLS=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TESTING_TOOLS", "true");
    const { status, json } = await askJson({ question, simulateFailure: true });
    expect(status).toBe(503);
    expect(json).toEqual(expectedFailure);
  });
});

/* ----------------------- Real-world model failure modes ---------------------- */

describe("MOCKED model — failure handling", () => {
  const question = "When is the next coaching session?";

  it("maps a refused connection to MODEL_UNAVAILABLE (503) without leaking internals", async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    const { status, json } = await askJson({ question });
    expect(status).toBe(503);
    expect(json).toMatchObject({ status: "error", code: "MODEL_UNAVAILABLE" });
    expectNoLeaks(json);
  });

  it("maps a timeout to MODEL_TIMEOUT (504) using the AbortController", async () => {
    vi.stubEnv("OLLAMA_TIMEOUT_MS", "40");
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    const { status, json } = await askJson({ question });
    expect(status).toBe(504);
    expect(json).toMatchObject({ status: "error", code: "MODEL_TIMEOUT" });
    expectNoLeaks(json);
  });

  it("maps a non-200 response to MODEL_UNAVAILABLE (503)", async () => {
    fetchMock.mockResolvedValue(new Response("internal error with details /srv/ollama/stack", { status: 500 }));
    const { status, json } = await askJson({ question });
    expect(status).toBe(503);
    expect(json).toMatchObject({ status: "error", code: "MODEL_UNAVAILABLE" });
    expect(JSON.stringify(json)).not.toContain("/srv/ollama");
  });

  it("maps 'model not found' to MODEL_NOT_FOUND (503)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "model 'qwen2.5:3b' not found, try pulling it first" }), { status: 404 }),
    );
    const { status, json } = await askJson({ question });
    expect(status).toBe(503);
    expect(json).toMatchObject({ status: "error", code: "MODEL_NOT_FOUND" });
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>nope</html>", { status: 200 })],
    ["a reply with no message content", () => new Response(JSON.stringify({ done: true }), { status: 200 })],
    ["an empty message", () => ollamaEnvelope("   ")],
    ["a model reply that is not JSON", () => ollamaEnvelope("Sure! Tuesdays at 16:00.")],
    ["a model reply missing 'answerable'", () => ollamaEnvelope(JSON.stringify({ answer: "x", source_ids: [] }))],
  ])("maps %s to MODEL_BAD_RESPONSE (502)", async (_name, makeResponse) => {
    fetchMock.mockResolvedValue(makeResponse());
    const { status, json } = await askJson({ question });
    expect(status).toBe(502);
    expect(json).toMatchObject({ status: "error", code: "MODEL_BAD_RESPONSE" });
    expect("answer" in json).toBe(false);
  });

  it("never substitutes a mock answer after a failed request", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { json } = await askJson({ question });
    expect(json.status).toBe("error");
    expect(JSON.stringify(json)).not.toMatch(/Tuesday|16:00/);
  });
});

/* ------------------------------ Validation ------------------------------ */

describe("request validation", () => {
  it.each([
    ["an empty question", { question: "" }],
    ["a whitespace-only question", { question: "   \n  " }],
    ["a missing question", {}],
    ["a non-string question", { question: 42 }],
    ["an over-long question", { question: "a".repeat(501) }],
    ["a body that is not JSON", "not json"],
    ["a null body", "null"],
  ])("rejects %s with 400 INVALID_REQUEST and never calls the model", async (_name, body) => {
    const { status, json } = await askJson(body);
    expect(status).toBe(400);
    expect(json).toMatchObject({ status: "error", code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a question of exactly the maximum length", async () => {
    const { status } = await askJson({ question: "a".repeat(500) });
    expect(status).toBe(200); // abstains: nothing in the documents matches
  });
});

/* ------------------------------ Health check ------------------------------ */

describe("MOCKED model — GET /api/health", () => {
  async function health(): Promise<HealthResponse> {
    return (await healthGET()).json() as Promise<HealthResponse>;
  }

  it("reports connected only when the server is reachable and the model is installed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }), { status: 200 }));
    const result = await health();
    expect(result).toMatchObject({ status: "connected", model: "qwen2.5:3b" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${OLLAMA_URL}/api/tags`);
    expect(JSON.stringify(result)).not.toContain("ollama.test");
  });

  it("reports unavailable when the model is not installed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }), { status: 200 }));
    expect(await health()).toMatchObject({ status: "unavailable", reason: "MODEL_NOT_INSTALLED" });
  });

  it("reports unavailable when the server cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await health()).toMatchObject({ status: "unavailable", reason: "SERVER_UNREACHABLE" });
  });

  it("reports unavailable when the server errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect(await health()).toMatchObject({ status: "unavailable", reason: "SERVER_ERROR" });
  });

  it("only exposes the testing tools flag outside production", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    expect((await health()).testingTools).toBe(true); // NODE_ENV is "test" under Vitest

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TESTING_TOOLS", "");
    expect((await health()).testingTools).toBe(false);
  });
});
