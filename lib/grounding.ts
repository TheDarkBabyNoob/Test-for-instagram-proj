import { SUPPORT_EMAIL } from "./constants";
import { ModelError } from "./ollama";
import { tokenize, type RetrievalIndex, type ScoredPassage } from "./retrieval";
import type { Source } from "./types";

/**
 * Grounding safeguards that do not depend on the model behaving:
 *  1. explicit handling of topics the documents say they do not cover,
 *  2. strict parsing of the model's structured reply,
 *  3. validation that the answer and its citations are supported by retrieved text.
 *
 * These checks reduce unsupported answers; they cannot prove an answer is correct.
 */

export const ABSTAIN_MESSAGE = "The information is not available in the supplied documents.";
export { SUPPORT_EMAIL };

/* ------------------- known missing-information topics ------------------ */

interface MissingTopic {
  id: string;
  /** Wording used in the abstention message, e.g. "refund policy". */
  label: string;
  pattern: RegExp;
}

/**
 * Document 3 states that it contains no pricing, refund rules or job placement
 * promises and that members should be referred to support. Detecting these
 * topics up front enforces that rule without asking the model to guess.
 */
export const MISSING_INFO_TOPICS: MissingTopic[] = [
  {
    id: "pricing",
    label: "pricing",
    pattern:
      /\b(prices?|pricing|priced|costs?|costing|fees?|how much|subscriptions?|tuition|discounts?|coupons?|payments?|free)\b|[$€£]/i,
  },
  {
    id: "refund",
    label: "refund policy",
    pattern: /\b(refunds?|refunded|refundable|money[- ]back|reimburse\w*|chargebacks?)\b/i,
  },
  {
    id: "placement",
    label: "job placement",
    pattern:
      /\b(jobs?|placements?|careers?|employ\w*|hir(?:e|ed|ing)|salar(?:y|ies)|internships?|recruit\w*)\b/i,
  },
];

export function detectMissingInfoTopics(question: string): MissingTopic[] {
  return MISSING_INFO_TOPICS.filter((topic) => topic.pattern.test(question));
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Abstention message for a topic the documents explicitly do not cover. */
export function missingTopicMessage(topics: MissingTopic[]): string {
  const what = joinLabels(topics.map((t) => t.label));
  return `${ABSTAIN_MESSAGE} They do not specify BrightPath Learn's ${what}. Please contact ${SUPPORT_EMAIL} for assistance.`;
}

/** Finds the document statement that says pricing/refunds/placement are not covered, if present. */
export function findMissingInfoStatement(index: RetrievalIndex): ScoredPassage | null {
  const found = index.passages.find((p) =>
    /does not contain\b[^.]*\b(pricing|refund|placement)/i.test(p.text),
  );
  return found ? { ...found, score: 0 } : null;
}

export function toSource(passage: ScoredPassage): Source {
  return {
    documentId: passage.documentId,
    documentTitle: passage.documentTitle,
    documentNumber: passage.documentNumber,
    excerpt: passage.text,
    score: passage.score,
  };
}

/* ------------------------- model reply parsing ------------------------- */

export interface ModelAnswer {
  answerable: boolean;
  sourceIds: string[];
  answer: string;
}

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

/** Parses the structured reply. Anything malformed is a MODEL_BAD_RESPONSE, never a guess. */
export function parseModelAnswer(content: string): ModelAnswer {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(content));
  } catch {
    throw new ModelError("MODEL_BAD_RESPONSE", "Model reply was not valid JSON.");
  }

  const record = raw as { answerable?: unknown; answer?: unknown; source_ids?: unknown } | null;
  if (typeof record !== "object" || record === null || typeof record.answerable !== "boolean") {
    throw new ModelError("MODEL_BAD_RESPONSE", "Model reply is missing a boolean 'answerable'.");
  }
  if (typeof record.answer !== "string") {
    throw new ModelError("MODEL_BAD_RESPONSE", "Model reply is missing a string 'answer'.");
  }
  const ids = Array.isArray(record.source_ids) ? record.source_ids : [];
  return {
    answerable: record.answerable,
    answer: record.answer.trim(),
    sourceIds: ids.filter((id): id is string => typeof id === "string"),
  };
}

/* ------------------------- answer validation -------------------------- */

export type RejectionReason =
  | "NOT_ANSWERABLE"
  | "EMPTY_ANSWER"
  | "NO_VALID_CITATION"
  | "UNSUPPORTED_DETAILS"
  | "LOW_SOURCE_OVERLAP"
  | "CREDENTIAL_REQUEST";

export type Verdict =
  | { ok: true; answer: string; sources: ScoredPassage[] }
  | { ok: false; reason: RejectionReason };

/** Share of the answer's content words that must appear in the cited passages or the question. */
export const MIN_ANSWER_COVERAGE = 0.6;
/** A cited passage must share at least this many content words with the answer to count as support. */
const MIN_SHARED_TOKENS_PER_SOURCE = 2;

function normaliseLabel(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const token of a) if (b.has(token)) n += 1;
  return n;
}

/** Numbers/times, e-mail addresses and URLs in the answer must literally occur in the sources. */
function unsupportedSpecifics(answer: string, evidence: string): string[] {
  const haystack = evidence.toLowerCase();
  const patterns = [/\d+(?::\d+)?/g, /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, /https?:\/\/\S+/g];
  const missing: string[] = [];
  for (const pattern of patterns) {
    for (const match of answer.toLowerCase().match(pattern) ?? []) {
      if (!haystack.includes(match.replace(/[.,;:]+$/, ""))) missing.push(match);
    }
  }
  return missing;
}

/** True if a sentence asks the member to hand over a password or credential. */
export function requestsCredentials(answer: string): boolean {
  const sentences = answer.split(/(?<=[.!?])\s+/);
  const ask =
    /\b(send|share|provide|give|email|e-mail|tell|enter|type|submit|text|reply with|confirm)\b[^.?!]{0,60}\b(password|passcode|pin|credentials?|login details)\b/i;
  const negation = /\b(never|not|don't|do not|won't|cannot|can't|shouldn't|should not|no need)\b/i;
  return sentences.some((s) => ask.test(s) && !negation.test(s));
}

/**
 * Checks the model's reply against the passages it was given. A reply is only
 * accepted if it cites real retrieved passages that actually overlap with the
 * answer, introduces no new numbers/addresses/links, mostly reuses words from
 * the evidence, and does not ask for credentials.
 */
export function validateAnswer(
  model: ModelAnswer,
  labels: Map<string, ScoredPassage>,
  question: string,
): Verdict {
  if (!model.answerable) return { ok: false, reason: "NOT_ANSWERABLE" };
  if (!model.answer) return { ok: false, reason: "EMPTY_ANSWER" };
  if (requestsCredentials(model.answer)) return { ok: false, reason: "CREDENTIAL_REQUEST" };

  const answerTokens = new Set(tokenize(model.answer));

  // 1. Resolve citations to real retrieved passages (unknown labels are ignored).
  const cited = new Map<string, ScoredPassage>();
  for (const id of model.sourceIds) {
    const passage = labels.get(normaliseLabel(id));
    if (passage) cited.set(passage.id, passage);
  }
  // 2. Keep only passages that really overlap with the answer text. If none of the cited
  //    passages do (or nothing valid was cited), fall back to the retrieved passages that do:
  //    a citation is only ever a real, overlapping passage, never an invented one.
  const needed = Math.max(Math.min(MIN_SHARED_TOKENS_PER_SOURCE, answerTokens.size), 1);
  const overlapping = (passages: ScoredPassage[]) =>
    passages
      .filter((p) => sharedCount(answerTokens, new Set(tokenize(p.text))) >= needed)
      .sort((a, b) => b.score - a.score);

  let supporting = overlapping([...cited.values()]);
  if (supporting.length === 0) supporting = overlapping([...labels.values()]);
  if (supporting.length === 0) return { ok: false, reason: "NO_VALID_CITATION" };

  // 4. No invented numbers, addresses or links.
  const evidence = `${supporting.map((p) => p.text).join(" ")} ${question}`;
  if (unsupportedSpecifics(model.answer, evidence).length > 0) {
    return { ok: false, reason: "UNSUPPORTED_DETAILS" };
  }

  // 5. Most of the answer's wording must come from the evidence or the question.
  const evidenceTokens = new Set(tokenize(evidence));
  if (answerTokens.size > 0 && sharedCount(answerTokens, evidenceTokens) / answerTokens.size < MIN_ANSWER_COVERAGE) {
    return { ok: false, reason: "LOW_SOURCE_OVERLAP" };
  }

  return { ok: true, answer: model.answer, sources: supporting };
}
