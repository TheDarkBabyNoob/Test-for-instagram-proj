"use client";

import type { ReactNode } from "react";
import { Info, LoaderCircle, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnsweredResponse, ErrorCode, UnsupportedResponse } from "@/lib/types";

const EMAIL_PATTERN = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/** Turns e-mail addresses in the answer into mailto: links; everything else stays plain text. */
function linkifyEmails(text: string): ReactNode[] {
  return text.split(EMAIL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={`mailto:${part}`}
        className="rounded-sm font-medium text-primary underline underline-offset-2 hover:text-brand-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export function AnswerCard({ result }: { result: AnsweredResponse | UnsupportedResponse }) {
  const unsupported = result.status === "unsupported";

  if (unsupported) {
    return (
      <Card className="gap-2 rounded-xl border-primary/20 bg-accent p-5 shadow-none">
        <div className="flex items-center gap-2">
          <Info className="size-5 text-primary" aria-hidden="true" />
          <h2 className="text-[17px] font-semibold">Information not available</h2>
        </div>
        <p className="text-[15px] leading-7 text-foreground sm:text-base">{linkifyEmails(result.answer)}</p>
      </Card>
    );
  }

  return (
    <Card className="gap-2 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-[17px] font-semibold">Answer</h2>
      </div>
      <p className="text-[15px] leading-7 text-foreground sm:text-base">{linkifyEmails(result.answer)}</p>
    </Card>
  );
}

/** Client-side failures (e.g. the app server itself is unreachable) use this extra code. */
export type DisplayErrorCode = ErrorCode | "NETWORK_ERROR";

interface ErrorCopy {
  title: string;
  description: (model?: string) => string;
}

const ERROR_COPY: Record<DisplayErrorCode, ErrorCopy> = {
  MODEL_UNAVAILABLE: {
    title: "AI model unavailable",
    description: () =>
      "We couldn't connect to the language model. Check that Ollama is running and try again.",
  },
  MODEL_NOT_FOUND: {
    title: "AI model unavailable",
    description: (model) =>
      `The language model isn't installed. Run “ollama pull ${model ?? "qwen2.5:3b"}” and try again.`,
  },
  MODEL_TIMEOUT: {
    title: "AI model timed out",
    description: () => "The language model took too long to respond. Please try again.",
  },
  MODEL_BAD_RESPONSE: {
    title: "Unexpected model response",
    description: () => "The language model replied in a format we couldn't use. Please try again.",
  },
  INVALID_REQUEST: {
    title: "Check your question",
    description: () => "Please enter a question of up to 500 characters.",
  },
  INTERNAL_ERROR: {
    title: "Something went wrong",
    description: () => "We couldn't complete your request. Please try again.",
  },
  NETWORK_ERROR: {
    title: "Connection problem",
    description: () => "We couldn't reach the app server. Check your connection and try again.",
  },
};

interface ErrorCardProps {
  code: DisplayErrorCode;
  /** Message supplied by the API; used for validation errors. */
  message?: string;
  model?: string;
  onRetry: () => void;
}

export function ErrorCard({ code, message, model, onRetry }: ErrorCardProps) {
  const copy = ERROR_COPY[code];
  const description = code === "INVALID_REQUEST" && message ? message : copy.description(model);

  return (
    <Alert className="gap-y-1 rounded-xl border-destructive/30 bg-[#fef2f2] p-4 text-foreground shadow-none">
      <TriangleAlert className="text-destructive" aria-hidden="true" />
      <AlertTitle className="text-[15px] font-semibold text-destructive">{copy.title}</AlertTitle>
      <AlertDescription className="text-sm text-foreground/80">
        <p>{description}</p>
        <p className="mt-1">No answer was generated, so nothing is shown here.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 h-9 border-destructive/30 bg-card px-3 text-foreground hover:bg-muted"
          onClick={onRetry}
        >
          <RotateCcw aria-hidden="true" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Placeholder shown while the request is running. Layout only; no fake progress. */
export function AnswerSkeleton() {
  return (
    <Card className="gap-3 rounded-xl p-5 shadow-none" aria-hidden="true">
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-5 animate-spin text-primary" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
    </Card>
  );
}
