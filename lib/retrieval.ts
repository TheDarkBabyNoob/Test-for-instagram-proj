import type { KnowledgeDocument } from "./types";

/**
 * Minimal lexical retrieval: paragraph chunking, normalisation, TF-IDF vectors
 * and cosine similarity. With three tiny documents a custom index is simpler
 * and easier to audit than a vector database or an embeddings service.
 *
 * This module is pure (no I/O) so it is trivial to test.
 */

export interface Passage {
  /** Stable id, e.g. "document-1:p4". */
  id: string;
  documentId: string;
  documentTitle: string;
  documentNumber: number;
  /** Exact substring of the source document (never rewritten). */
  text: string;
}

export interface ScoredPassage extends Passage {
  score: number;
}

export interface RetrievalIndex {
  passages: Passage[];
  /** Smoothed inverse document frequency per term. */
  idf: Map<string, number>;
  /** L2-normalised TF-IDF vector per passage (same order as `passages`). */
  vectors: Map<string, number>[];
  /** idf value used for terms that never occur in the corpus. */
  unseenIdf: number;
}

/**
 * Minimum cosine score for the best passage before we even consider asking the
 * model. It was chosen by inspecting scores for answerable, paraphrased and
 * unrelated questions (see tests/retrieval.test.ts). It is a cheap first filter,
 * not a guarantee: the model prompt and answer validation are separate layers.
 */
export const RELEVANCE_THRESHOLD = 0.22;

export const DEFAULT_TOP_K = 3;

/** Passages longer than this are split into sentences. */
const MAX_PASSAGE_CHARS = 320;

/* ----------------------------- chunking ----------------------------- */

interface RawChunk {
  text: string;
}

function splitSentences(line: string): RawChunk[] {
  const sentences = line.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [line];
  return sentences.map((s) => ({ text: s.trim() })).filter((c) => c.text.length > 0);
}

/**
 * One passage per non-empty line (each line in the supplied documents is a
 * self-contained paragraph). The leading "Platform: ..." line is boilerplate,
 * not evidence, so it is skipped. Over-long lines fall back to sentences.
 */
export function chunkDocument(doc: KnowledgeDocument): Passage[] {
  const passages: Passage[] = [];
  let counter = 0;

  for (const rawLine of doc.text.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^platform:/i.test(line)) continue;

    const pieces = line.length > MAX_PASSAGE_CHARS ? splitSentences(line) : [{ text: line }];
    for (const piece of pieces) {
      counter += 1;
      passages.push({
        id: `${doc.id}:p${counter}`,
        documentId: doc.id,
        documentTitle: doc.title,
        documentNumber: doc.number,
        text: piece.text,
      });
    }
  }
  return passages;
}

/* --------------------------- normalisation -------------------------- */

const STOPWORDS = new Set(
  (
    "a an the is are was were be been am do does did can could should would will shall may might " +
    "i me my mine we our you your he she it its they them their this that these those " +
    "to of in on at for from by with about as into and or but if then so than there here " +
    "what which who whom how when where why any some no not only also very just please tell want need " +
    "get got has have had next brightpath learn example platform fictional"
  ).split(" "),
);

/**
 * Small lexical normalisation table that stands in for embeddings. It maps a few
 * common paraphrases onto the vocabulary used by the documents. Lexical
 * retrieval remains limited for wording outside this list.
 */
const SYNONYMS: Record<string, string> = {
  finish: "complete",
  finished: "complete",
  finishing: "complete",
  done: "complete",
  track: "save",
  tracking: "save",
  tracked: "save",
  bookmark: "save",
  class: "lesson",
  classes: "lesson",
  lecture: "lesson",
  lectures: "lesson",
  module: "lesson",
  modules: "lesson",
  meeting: "session",
  meetings: "session",
  call: "session",
  calls: "session",
  webinar: "session",
  workshop: "session",
  review: "feedback",
  reviews: "feedback",
  reviewed: "feedback",
  critique: "feedback",
  evaluation: "feedback",
  replay: "recording",
  replays: "recording",
  rewatch: "recording",
  login: "sign",
  logon: "sign",
  log: "sign",
  signin: "sign",
  lost: "forgot",
  forget: "forgot",
  forgotten: "forgot",
  recover: "forgot",
  passcode: "password",
  assistance: "support",
  help: "support",
  helpdesk: "support",
  open: "available",
  opening: "available",
  availability: "available",
};

/** Very small suffix stemmer: enough to match lesson/lessons, complete/completed/completing. */
export function stem(word: string): string {
  if (/\d/.test(word) || word.length <= 3) return word;
  let w = word;

  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);

  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ly") && w.length > 5) w = w.slice(0, -2);

  // "resetting" -> "resett" -> "reset"
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !/[lsz]$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith("e") && w.length > 3) w = w.slice(0, -1);
  return w;
}

/** Lowercases, splits, removes stopwords, applies synonyms and stems. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+(?::[0-9]+)?/g) ?? [];
  const tokens: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    const canonical = SYNONYMS[word] ?? word;
    tokens.push(stem(canonical));
  }
  return tokens;
}

/* ------------------------------ indexing ----------------------------- */

function termFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

function weigh(tokens: string[], idfOf: (term: string) => number): Map<string, number> {
  const vector = new Map<string, number>();
  let norm = 0;
  for (const [term, count] of termFrequencies(tokens)) {
    const weight = (1 + Math.log(count)) * idfOf(term);
    vector.set(term, weight);
    norm += weight * weight;
  }
  const length = Math.sqrt(norm);
  if (length > 0) for (const [term, weight] of vector) vector.set(term, weight / length);
  return vector;
}

export function buildIndex(documents: KnowledgeDocument[]): RetrievalIndex {
  const passages = documents.flatMap(chunkDocument);
  const tokenLists = passages.map((p) => tokenize(p.text));

  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenLists) {
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const n = passages.length;
  const idf = new Map<string, number>();
  for (const [term, df] of documentFrequency) idf.set(term, Math.log((n + 1) / (df + 1)) + 1);
  const unseenIdf = Math.log(n + 1) + 1;

  const idfOf = (term: string) => idf.get(term) ?? unseenIdf;
  const vectors = tokenLists.map((tokens) => weigh(tokens, idfOf));
  return { passages, idf, vectors, unseenIdf };
}

/* ------------------------------ retrieval ---------------------------- */

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  return dot;
}

/**
 * Returns up to `k` passages ranked by cosine similarity with the question.
 * Terms that never occur in the documents still count towards the question's
 * length, so a question that is mostly about things the documents never mention
 * scores low even if one generic word (e.g. "lesson") overlaps.
 */
export function retrieve(index: RetrievalIndex, question: string, k = DEFAULT_TOP_K): ScoredPassage[] {
  const query = weigh(tokenize(question), (term) => index.idf.get(term) ?? index.unseenIdf);
  if (query.size === 0) return [];

  return index.passages
    .map((passage, i) => ({ ...passage, score: cosine(query, index.vectors[i]) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((p) => ({ ...p, score: Math.round(p.score * 1000) / 1000 }));
}

/** First layer of the relevance check: is the best passage similar enough to bother the model? */
export function hasRelevantEvidence(results: ScoredPassage[]): boolean {
  return results.length > 0 && results[0].score >= RELEVANCE_THRESHOLD;
}
