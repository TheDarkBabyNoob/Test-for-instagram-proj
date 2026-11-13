import { loadDocuments } from "./documents";
import {
  ABSTAIN_MESSAGE,
  detectMissingInfoTopics,
  findMissingInfoStatement,
  missingTopicMessage,
  parseModelAnswer,
  toSource,
  validateAnswer,
} from "./grounding";
import { chat, simulatedModelFailure } from "./ollama";
import { ANSWER_SCHEMA, buildPrompt } from "./prompt";
import { buildIndex, hasRelevantEvidence, retrieve, type RetrievalIndex } from "./retrieval";
import type { AnsweredResponse, UnsupportedResponse } from "./types";

let indexPromise: Promise<RetrievalIndex> | null = null;

/** Builds the TF-IDF index once per server process from the files in /documents. */
export function getIndex(): Promise<RetrievalIndex> {
  if (!indexPromise) {
    indexPromise = loadDocuments().then(buildIndex);
    indexPromise.catch(() => {
      indexPromise = null; // do not cache a failed load
    });
  }
  return indexPromise;
}

/** Test helper. */
export function resetIndexCache(): void {
  indexPromise = null;
}

export interface AskOptions {
  /** Testing tool: fail exactly like an unreachable model. Only honoured by the route when enabled. */
  simulateFailure?: boolean;
}

function abstain(): UnsupportedResponse {
  return { status: "unsupported", answer: ABSTAIN_MESSAGE, sources: [] };
}

/**
 * Full pipeline: question -> retrieval -> relevance check -> grounded model
 * call -> answer validation. Throws ModelError when the model boundary fails;
 * it never returns a made-up answer in that case.
 */
export async function answerQuestion(
  question: string,
  options: AskOptions = {},
): Promise<AnsweredResponse | UnsupportedResponse> {
  // The simulated failure goes through the same ModelError path as a real outage.
  if (options.simulateFailure) throw simulatedModelFailure();

  const index = await getIndex();

  // Known out-of-scope topics (pricing, refunds, job placement): Document 3 says so explicitly.
  const topics = detectMissingInfoTopics(question);
  if (topics.length > 0) {
    const statement = findMissingInfoStatement(index);
    const score = statement
      ? (retrieve(index, question, index.passages.length).find((p) => p.id === statement.id)?.score ?? 0)
      : 0;
    return {
      status: "unsupported",
      answer: missingTopicMessage(topics),
      sources: statement ? [toSource({ ...statement, score })] : [],
    };
  }

  // First relevance layer: is anything in the documents lexically close to the question?
  const passages = retrieve(index, question);
  if (!hasRelevantEvidence(passages)) return abstain();

  // Grounded generation, then validate the reply against the passages it was given.
  const { messages, labels } = buildPrompt(question, passages);
  const content = await chat(messages, { format: ANSWER_SCHEMA });
  const verdict = validateAnswer(parseModelAnswer(content), labels, question);
  if (!verdict.ok) return abstain();

  return { status: "answered", answer: verdict.answer, sources: verdict.sources.map(toSource) };
}
