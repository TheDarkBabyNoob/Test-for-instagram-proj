// Server-only module: it reads from disk, so it must never be imported by client components.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeDocument } from "./types";

/**
 * The knowledge base is exactly these three files. Titles are metadata only;
 * all document content comes from the .txt files on disk.
 */
const DOCUMENT_REGISTRY = [
  {
    id: "document-1",
    number: 1,
    title: "Getting started",
    sidebarLabel: "Getting Started",
    file: "getting-started.txt",
  },
  {
    id: "document-2",
    number: 2,
    title: "Coaching and feedback",
    sidebarLabel: "Coaching & Feedback",
    file: "coaching-feedback.txt",
  },
  {
    id: "document-3",
    number: 3,
    title: "Account help",
    sidebarLabel: "Account Help",
    file: "account-help.txt",
  },
] as const;

export function documentsDirectory(): string {
  return path.join(process.cwd(), "documents");
}

let cache: Promise<KnowledgeDocument[]> | null = null;

async function readAll(): Promise<KnowledgeDocument[]> {
  const dir = documentsDirectory();
  return Promise.all(
    DOCUMENT_REGISTRY.map(async ({ file, ...meta }) => {
      // Normalise line endings so excerpts match regardless of how git checked the files out.
      const raw = await readFile(path.join(dir, file), "utf8");
      return { ...meta, text: raw.replace(/\r\n?/g, "\n") };
    }),
  );
}

/** Loads the three documents once per server process. */
export function loadDocuments(): Promise<KnowledgeDocument[]> {
  if (!cache) {
    cache = readAll().catch((error) => {
      cache = null; // do not cache a failed load
      throw error;
    });
  }
  return cache;
}

/** Test helper: forget cached documents. */
export function resetDocumentCache(): void {
  cache = null;
}
