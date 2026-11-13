/**
 * Types shared by the server (retrieval, API routes) and the UI.
 * This file must stay free of server-only imports so client components can use it.
 */

/** A document as the UI sees it (title plus the full original text). */
export interface KnowledgeDocument {
  id: string;
  /** 1-based position, used for labels such as "Document 1 — Getting started". */
  number: number;
  /** Official title, e.g. "Getting started". */
  title: string;
  /** Short name for the sidebar, e.g. "Getting Started". */
  sidebarLabel: string;
  text: string;
}

/** A passage that supports (or explicitly disclaims) an answer, quoted verbatim from a document. */
export interface Source {
  documentId: string;
  documentTitle: string;
  documentNumber: number;
  /** Exact text of the passage as it appears in the document file. */
  excerpt: string;
  /** Lexical (TF-IDF cosine) retrieval score. A ranking signal, not a confidence. */
  score: number;
}

export interface AnsweredResponse {
  status: "answered";
  answer: string;
  sources: Source[];
}

export interface UnsupportedResponse {
  status: "unsupported";
  answer: string;
  /** Usually empty. Contains the document statement that says the topic is out of scope, when one exists. */
  sources: Source[];
}

export type ErrorCode =
  | "INVALID_REQUEST"
  | "MODEL_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "MODEL_TIMEOUT"
  | "MODEL_BAD_RESPONSE"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  status: "error";
  code: ErrorCode;
  message: string;
}

export type AskResponse = AnsweredResponse | UnsupportedResponse | ErrorResponse;

export interface AskRequest {
  question: string;
  simulateFailure?: boolean;
}

export type HealthStatus = "connected" | "unavailable";

export interface HealthResponse {
  status: HealthStatus;
  model: string;
  /** Present only when status is "unavailable". */
  reason?: "SERVER_UNREACHABLE" | "MODEL_NOT_INSTALLED" | "SERVER_ERROR";
  /** True when the "Simulate API failure" control may be shown and honoured. */
  testingTools: boolean;
}
