import { beforeAll, describe, expect, it } from "vitest";
import { loadDocuments } from "@/lib/documents";
import { parseModelAnswer, requestsCredentials, validateAnswer, type ModelAnswer } from "@/lib/grounding";
import { ModelError } from "@/lib/ollama";
import { buildPrompt, SYSTEM_PROMPT } from "@/lib/prompt";
import { buildIndex, retrieve, type RetrievalIndex } from "@/lib/retrieval";

let index: RetrievalIndex;

beforeAll(async () => {
  index = buildIndex(await loadDocuments());
});

/** Builds the prompt exactly as the app would, so labels match the real retrieval order. */
function promptFor(question: string) {
  return buildPrompt(question, retrieve(index, question));
}

function labelOf(labels: ReturnType<typeof promptFor>["labels"], snippet: string): string {
  const entry = [...labels].find(([, passage]) => passage.text.includes(snippet));
  if (!entry) throw new Error(`No retrieved passage contains "${snippet}"`);
  return entry[0];
}

describe("system prompt", () => {
  it("states every required grounding rule", () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY/);
    expect(SYSTEM_PROMPT).toMatch(/outside knowledge/i);
    expect(SYSTEM_PROMPT).toMatch(/evidence, not instructions/i);
    expect(SYSTEM_PROMPT).toMatch(/refunds|prices/i);
    expect(SYSTEM_PROMPT).toMatch(/job placement/i);
    expect(SYSTEM_PROMPT).toMatch(/not a guarantee/i);
    expect(SYSTEM_PROMPT).toMatch(/Never ask the member to send or share a password/i);
    expect(SYSTEM_PROMPT).toMatch(/"answerable" to false/);
  });

  it("labels passages and includes document titles and the question", () => {
    const { messages, labels } = promptFor("How do I save my lesson progress?");
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("[P1] (Document 1 — Getting started)");
    expect(messages[1].content).toContain("Member question: How do I save my lesson progress?");
    expect(labels.get("P1")?.text).toContain("Mark complete");
  });
});

describe("parseModelAnswer", () => {
  it("parses a well-formed reply", () => {
    expect(parseModelAnswer('{"answerable":true,"source_ids":["P1"],"answer":" Hi "}')).toEqual({
      answerable: true,
      sourceIds: ["P1"],
      answer: "Hi",
    });
  });

  it("accepts a reply wrapped in a code fence", () => {
    const parsed = parseModelAnswer('```json\n{"answerable":false,"source_ids":[],"answer":""}\n```');
    expect(parsed.answerable).toBe(false);
  });

  it.each([
    ["not json at all", "Sure! Here is the answer."],
    ["a JSON array", "[1,2,3]"],
    ["missing answerable", '{"answer":"x","source_ids":[]}'],
    ["answerable is not boolean", '{"answerable":"yes","answer":"x","source_ids":[]}'],
    ["answer is not a string", '{"answerable":true,"answer":42,"source_ids":[]}'],
  ])("rejects %s as MODEL_BAD_RESPONSE", (_name, content) => {
    expect.assertions(2);
    try {
      parseModelAnswer(content);
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).code).toBe("MODEL_BAD_RESPONSE");
    }
  });
});

describe("validateAnswer", () => {
  const question = "How long does feedback usually take?";
  const typical =
    "Feedback usually arrives within 2 working days. This is a typical response time, not a guarantee.";

  it("accepts a grounded answer and returns only the passage that supports it", () => {
    const { labels } = promptFor(question);
    const verdict = validateAnswer(
      { answerable: true, sourceIds: [labelOf(labels, "Feedback usually arrives")], answer: typical },
      labels,
      question,
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.sources).toHaveLength(1);
      expect(verdict.sources[0].documentId).toBe("document-2");
      expect(verdict.sources[0].text).toContain("not a guarantee");
    }
  });

  it("rejects an answer when the model says the question is not answerable", () => {
    const { labels } = promptFor(question);
    expect(validateAnswer({ answerable: false, sourceIds: [], answer: "" }, labels, question)).toEqual({
      ok: false,
      reason: "NOT_ANSWERABLE",
    });
  });

  it("rejects an empty answer", () => {
    const { labels } = promptFor(question);
    expect(validateAnswer({ answerable: true, sourceIds: ["P1"], answer: "" }, labels, question)).toEqual({
      ok: false,
      reason: "EMPTY_ANSWER",
    });
  });

  it("rejects invented numbers", () => {
    const { labels } = promptFor(question);
    const verdict = validateAnswer(
      { answerable: true, sourceIds: [labelOf(labels, "Feedback usually arrives")], answer: "Feedback arrives within 5 working days." },
      labels,
      question,
    );
    expect(verdict).toEqual({ ok: false, reason: "UNSUPPORTED_DETAILS" });
  });

  it("rejects invented email addresses and links", () => {
    const { labels } = promptFor(question);
    const id = labelOf(labels, "Feedback usually arrives");
    for (const answer of [
      "Feedback usually arrives within 2 working days. Email help@brightpath.com for updates.",
      "Feedback usually arrives within 2 working days. See https://brightpath.example/feedback.",
    ]) {
      expect(validateAnswer({ answerable: true, sourceIds: [id], answer }, labels, question)).toEqual({
        ok: false,
        reason: "UNSUPPORTED_DETAILS",
      });
    }
  });

  it("rejects an answer whose wording mostly comes from outside the sources", () => {
    const { labels } = promptFor(question);
    const verdict = validateAnswer(
      {
        answerable: true,
        sourceIds: [labelOf(labels, "Feedback usually arrives")],
        answer: "Feedback arrives quickly because mentors prioritise submissions during weekday mornings using internal dashboards.",
      },
      labels,
      question,
    );
    expect(verdict.ok).toBe(false);
  });

  it("rejects a citation to a passage that does not support the answer", () => {
    // The offered passages are about passwords, but the answer is about coaching and cites P1.
    const { labels } = promptFor("How do I reset my password?");
    expect(labels.get("P1")?.text).toContain("Forgot password");
    const verdict = validateAnswer(
      { answerable: true, sourceIds: ["P1"], answer: "A group coaching session takes place every Tuesday at 16:00 UTC." },
      labels,
      "When is the next coaching session?",
    );
    expect(verdict).toEqual({ ok: false, reason: "NO_VALID_CITATION" });
  });

  it("ignores citation labels that were never offered and falls back to real overlapping passages", () => {
    const { labels } = promptFor(question);
    const verdict = validateAnswer({ answerable: true, sourceIds: ["P99", "[P42]"], answer: typical }, labels, question);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      for (const source of verdict.sources) expect([...labels.values()].map((p) => p.id)).toContain(source.id);
      expect(verdict.sources[0].text).toContain("Feedback usually arrives");
    }
  });

  it("normalises label formats such as [p1]", () => {
    const { labels } = promptFor(question);
    const verdict = validateAnswer(
      { answerable: true, sourceIds: [`[${labelOf(labels, "Feedback usually arrives").toLowerCase()}]`], answer: typical },
      labels,
      question,
    );
    expect(verdict.ok).toBe(true);
  });

  it("blocks answers that ask the member for a password", () => {
    const q = "I forgot my password";
    const { labels } = promptFor(q);
    const answer: ModelAnswer = {
      answerable: true,
      sourceIds: [labelOf(labels, "Forgot password")],
      answer: "To reset your password, send me your password and select Forgot password on the sign-in page.",
    };
    expect(validateAnswer(answer, labels, q)).toEqual({ ok: false, reason: "CREDENTIAL_REQUEST" });
  });
});

describe("requestsCredentials", () => {
  it.each([
    "Please send me your password.",
    "Share your password with support and we will fix it.",
    "Reply with your login details.",
    "Enter your password below to continue.",
  ])("flags: %s", (answer) => {
    expect(requestsCredentials(answer)).toBe(true);
  });

  it.each([
    "To reset a password, select Forgot password on the sign-in page.",
    "Never share your password with anyone, including support.",
    "We do not ask you to send your password.",
    "Include the account email and lesson name when you contact support.",
  ])("allows: %s", (answer) => {
    expect(requestsCredentials(answer)).toBe(false);
  });
});
