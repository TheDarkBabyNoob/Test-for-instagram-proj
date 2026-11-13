import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDocuments } from "@/lib/documents";
import {
  ABSTAIN_MESSAGE,
  detectMissingInfoTopics,
  findMissingInfoStatement,
  missingTopicMessage,
} from "@/lib/grounding";
import {
  RELEVANCE_THRESHOLD,
  buildIndex,
  chunkDocument,
  hasRelevantEvidence,
  retrieve,
  stem,
  tokenize,
  type RetrievalIndex,
} from "@/lib/retrieval";
import type { KnowledgeDocument } from "@/lib/types";

let documents: KnowledgeDocument[];
let index: RetrievalIndex;

beforeAll(async () => {
  documents = await loadDocuments();
  index = buildIndex(documents);
});

describe("document loading", () => {
  it("loads exactly the three supplied documents with stable ids and titles", () => {
    expect(documents.map((d) => [d.id, d.number, d.title])).toEqual([
      ["document-1", 1, "Getting started"],
      ["document-2", 2, "Coaching and feedback"],
      ["document-3", 3, "Account help"],
    ]);
  });

  it("returns the text of the files on disk", async () => {
    const onDisk = await readFile(path.join(process.cwd(), "documents", "getting-started.txt"), "utf8");
    expect(documents[0].text).toBe(onDisk.replace(/\r\n?/g, "\n"));
  });
});

describe("chunking", () => {
  it("makes every passage an exact substring of its own document", () => {
    for (const doc of documents) {
      const passages = chunkDocument(doc);
      expect(passages.length).toBeGreaterThan(0);
      for (const passage of passages) {
        expect(doc.text).toContain(passage.text);
        expect(passage.documentId).toBe(doc.id);
        expect(passage.documentTitle).toBe(doc.title);
      }
    }
  });

  it("skips the boilerplate 'Platform:' line", () => {
    expect(index.passages.some((p) => p.text.startsWith("Platform:"))).toBe(false);
  });

  it("keeps the 'typical, not a guarantee' caveat in the same passage as the timing", () => {
    const passage = index.passages.find((p) => p.text.startsWith("Feedback usually arrives"));
    expect(passage?.text).toContain("not a guarantee");
  });
});

describe("retrieval and document attribution", () => {
  const supported: Array<[question: string, documentId: string, mustContain: string]> = [
    ["How do I save my lesson progress?", "document-1", "Mark complete"],
    ["How do I save my progress?", "document-1", "Mark complete"],
    ["When is group coaching?", "document-2", "every Tuesday"],
    ["How long does feedback usually take?", "document-2", "Feedback usually arrives"],
    ["How do I request feedback?", "document-2", "Request feedback"],
    ["How do I reset my password?", "document-3", "Forgot password"],
    ["How many lessons are in the Foundations course?", "document-1", "6 lessons"],
    ["Do I have to watch lessons in order?", "document-1", "any order"],
    // Paraphrases that rely on the small normalisation table
    ["How do I make sure my lesson counts as done?", "document-1", "Mark complete"],
    ["How do I get my practice work reviewed?", "document-2", "Request feedback"],
    ["I forgot my password", "document-3", "Forgot password"],
  ];

  it.each(supported)("ranks the right passage first: %s", (question, documentId, mustContain) => {
    const [top] = retrieve(index, question);
    expect(top.documentId).toBe(documentId);
    expect(top.text).toContain(mustContain);
    expect(hasRelevantEvidence([top])).toBe(true);
  });

  it("keeps the schedule passage within the top results for a near-tie question", () => {
    // "coaching" and "session" appear in several Document 2 passages, so lexical scores are
    // close. The schedule must be retrieved (and shown to the model) even if it is not first.
    const results = retrieve(index, "When is the next coaching session?");
    expect(results.every((p) => p.documentId === "document-2")).toBe(true);
    expect(results.some((p) => p.text.includes("every Tuesday at 16:00 UTC"))).toBe(true);
  });

  it("finds support hours in Document 3 within the top results", () => {
    const results = retrieve(index, "What are support hours?");
    expect(results.some((p) => p.documentId === "document-3" && p.text.includes("Monday to Friday"))).toBe(true);
  });

  it("returns results sorted by score with complete metadata", () => {
    const results = retrieve(index, "When is the group coaching session?", 3);
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    for (const result of results) {
      expect(result.id).toMatch(/^document-\d:p\d+$/);
      expect(result.documentTitle).toBeTruthy();
      expect(result.documentNumber).toBeGreaterThan(0);
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it("never returns a passage that is not in the documents", () => {
    for (const question of ["refund", "coaching", "password reset", "xyzzy"]) {
      for (const passage of retrieve(index, question, 10)) {
        const doc = documents.find((d) => d.id === passage.documentId);
        expect(doc?.text).toContain(passage.text);
      }
    }
  });
});

describe("relevance threshold", () => {
  const unrelated = [
    "Does BrightPath have a mobile app?",
    "What is the capital of France?",
    "Who founded BrightPath?",
    "Can I download lessons for offline viewing?",
    "Is there a Spanish version of the course?",
    "How do I change my email address?",
    "How do I delete my account?",
    "What is the weather today?",
  ];

  it.each(unrelated)("treats an unrelated question as having no relevant evidence: %s", (question) => {
    expect(hasRelevantEvidence(retrieve(index, question))).toBe(false);
  });

  it("keeps the threshold between the unrelated and supported score ranges", () => {
    const best = (q: string) => retrieve(index, q)[0]?.score ?? 0;
    const unrelatedMax = Math.max(...unrelated.map(best));
    const supportedMin = Math.min(
      ...["How do I save my progress?", "How long does feedback usually take?", "I forgot my password"].map(best),
    );
    expect(unrelatedMax).toBeLessThan(RELEVANCE_THRESHOLD);
    expect(supportedMin).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
  });

  it("returns nothing for an empty or all-stopword question", () => {
    expect(retrieve(index, "")).toEqual([]);
    expect(retrieve(index, "what is the")).toEqual([]);
  });
});

describe("known missing-information policies (Document 3)", () => {
  it.each([
    ["What is BrightPath Learn's refund policy?", "refund policy"],
    ["Can I get my money back?", "refund policy"],
    ["How much does the course cost?", "pricing"],
    ["Is there a discount?", "pricing"],
    ["Will I get a job after finishing?", "job placement"],
    ["Do you guarantee job placement?", "job placement"],
  ])("detects %s", (question, label) => {
    expect(detectMissingInfoTopics(question).map((t) => t.label)).toContain(label);
  });

  it.each([
    "How do I save my lesson progress?",
    "When is the next coaching session?",
    "How long does feedback usually take?",
    "How do I reset my password?",
    "Does BrightPath have a mobile app?",
  ])("does not flag an ordinary question: %s", (question) => {
    expect(detectMissingInfoTopics(question)).toEqual([]);
  });

  it("finds the Document 3 statement that lists pricing, refunds and placement as out of scope", () => {
    const statement = findMissingInfoStatement(index);
    expect(statement?.documentId).toBe("document-3");
    expect(statement?.text).toContain("does not contain pricing, refund rules or job placement promises");
  });

  it("builds an abstention message that points to support", () => {
    const message = missingTopicMessage(detectMissingInfoTopics("What is the refund policy?"));
    expect(message).toContain(ABSTAIN_MESSAGE);
    expect(message).toContain("refund policy");
    expect(message).toContain("support@brightpath.example");
  });
});

describe("normalisation", () => {
  it("stems plurals and verb forms to a shared token", () => {
    expect(stem("lessons")).toBe(stem("lesson"));
    expect(stem("completed")).toBe(stem("complete"));
    expect(stem("recordings")).toBe(stem("recording"));
    expect(stem("resetting")).toBe(stem("reset"));
  });

  it("maps a few common paraphrases onto document vocabulary", () => {
    expect(tokenize("finished")).toEqual(tokenize("complete"));
    expect(tokenize("reviewed")).toEqual(tokenize("feedback"));
  });

  it("drops stopwords and brand boilerplate", () => {
    expect(tokenize("What is the BrightPath Learn thing?")).toEqual(["thing"]);
  });
});
