"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Menu, MessageSquareText } from "lucide-react";
import { AnswerCard, AnswerSkeleton, ErrorCard, type DisplayErrorCode } from "@/components/answer-card";
import { DocumentViewer } from "@/components/document-viewer";
import { QuestionInput } from "@/components/question-input";
import { Brand, SidebarContent } from "@/components/sidebar";
import { SourceCard } from "@/components/source-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AskResponse, HealthResponse, KnowledgeDocument } from "@/lib/types";

const SUGGESTIONS = [
  "How do I save my progress?",
  "When is group coaching?",
  "How do I request feedback?",
  "What is the refund policy?",
];

const HEALTH_POLL_MS = 30_000;

type Outcome =
  | { kind: "result"; response: Exclude<AskResponse, { status: "error" }> }
  | { kind: "error"; code: DisplayErrorCode; message?: string };

function isAskResponse(value: unknown): value is AskResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "answered" || value.status === "unsupported" || value.status === "error")
  );
}

export function Assistant({ documents }: { documents: KnowledgeDocument[] }) {
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [viewer, setViewer] = useState<{ documentId: string; highlight: string | null } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const inFlight = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  /* Real, server-side model health check (never "Connected" just because the page loaded). */
  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setHealth((await response.json()) as HealthResponse);
    } catch {
      setHealth((previous) => ({
        status: "unavailable",
        model: previous?.model ?? "",
        reason: "SERVER_UNREACHABLE",
        testingTools: previous?.testingTools ?? false,
      }));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refreshHealth, 0);
    const timer = setInterval(refreshHealth, HEALTH_POLL_MS);
    window.addEventListener("focus", refreshHealth);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", refreshHealth);
    };
  }, [refreshHealth]);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || inFlight.current) return; // blocks empty and duplicate submissions
      inFlight.current = true;
      setLoading(true);
      setLastQuestion(text);
      setOutcome(null);

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text, simulateFailure }),
        });
        const data: unknown = await response.json().catch(() => null);

        if (!isAskResponse(data)) {
          setOutcome({ kind: "error", code: "INTERNAL_ERROR" });
        } else if (data.status === "error") {
          setOutcome({ kind: "error", code: data.code, message: data.message });
        } else {
          setOutcome({ kind: "result", response: data });
        }
      } catch {
        setOutcome({ kind: "error", code: "NETWORK_ERROR" });
      } finally {
        inFlight.current = false;
        setLoading(false);
        void refreshHealth();
      }
    },
    [simulateFailure, refreshHealth],
  );

  useEffect(() => {
    if (outcome) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [outcome]);

  function askSuggestion(suggestion: string) {
    setQuestion(suggestion);
    void submit(suggestion);
  }

  function openDocument(documentId: string, highlight: string | null = null) {
    setMenuOpen(false);
    setViewer({ documentId, highlight });
  }

  const viewerDocument = viewer ? (documents.find((d) => d.id === viewer.documentId) ?? null) : null;

  const sidebar = (
    <SidebarContent
      documents={documents}
      health={health}
      simulateFailure={simulateFailure}
      onSimulateFailureChange={setSimulateFailure}
      onOpenDocument={(id) => openDocument(id)}
    />
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside aria-label="Knowledge base" className="sticky top-0 hidden h-dvh overflow-y-auto border-r bg-card lg:block">
        {sidebar}
      </aside>

      <div className="min-w-0">
        {/* Mobile header with a simple drawer for the document list */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur lg:hidden">
          <Brand />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label="Open knowledge base menu"
                  onClick={() => setMenuOpen(true)}
                />
              }
            >
              <Menu aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Knowledge base</TooltipContent>
          </Tooltip>
        </header>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-[85%] max-w-xs gap-0 overflow-y-auto p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Knowledge base</SheetTitle>
              <SheetDescription>Browse documents, model status and testing tools.</SheetDescription>
            </SheetHeader>
            {sidebar}
          </SheetContent>
        </Sheet>

        <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-8 lg:py-12">
          <header className="mb-8 space-y-2">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">
              Ask BrightPath AI
            </h1>
            <p className="text-[15px] text-muted-foreground sm:text-base">
              Get accurate answers grounded in official BrightPath Learn documentation.
            </p>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <FileText className="size-4" aria-hidden="true" />
              {documents.length} knowledge documents available
            </p>
          </header>

          <QuestionInput
            value={question}
            onChange={setQuestion}
            onSubmit={() => void submit(question)}
            loading={loading}
            suggestions={SUGGESTIONS}
            onSuggestion={askSuggestion}
          />

          <div ref={resultsRef} aria-live="polite" aria-busy={loading} className="mt-8 space-y-6 scroll-mt-20">
            {loading && <AnswerSkeleton />}

            {!loading && !outcome && (
              <Card className="items-center gap-2 rounded-xl border-dashed bg-transparent px-6 py-10 text-center shadow-none">
                <MessageSquareText className="size-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-[17px] font-semibold">Ask your first question</h2>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">
                  Answers come only from the knowledge base documents. Each one shows the exact passages it relied
                  on, and the assistant says so when the documents don&apos;t contain the answer.
                </p>
              </Card>
            )}

            {!loading && outcome?.kind === "error" && (
              <ErrorCard
                code={outcome.code}
                message={outcome.message}
                model={health?.model}
                onRetry={() => void submit(lastQuestion)}
              />
            )}

            {!loading && outcome?.kind === "result" && (
              <>
                <AnswerCard result={outcome.response} />
                {outcome.response.sources.length > 0 && (
                  <section aria-labelledby="sources-heading" className="space-y-3">
                    <h2 id="sources-heading" className="text-[17px] font-semibold">
                      {outcome.response.status === "answered" ? "Supporting sources" : "Source statement"}
                    </h2>
                    <ul
                      className={`grid gap-3 ${outcome.response.sources.length > 1 ? "md:grid-cols-2" : ""}`}
                    >
                      {outcome.response.sources.map((source) => (
                        <li key={`${source.documentId}:${source.excerpt}`} className="min-w-0">
                          <SourceCard
                            source={source}
                            onViewDocument={(id, excerpt) => openDocument(id, excerpt)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <DocumentViewer
        document={viewerDocument}
        highlight={viewer?.highlight ?? null}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
