"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MAX_QUESTION_LENGTH } from "@/lib/constants";

interface QuestionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  suggestions: string[];
  onSuggestion: (question: string) => void;
}

export function QuestionInput({
  value,
  onChange,
  onSubmit,
  loading,
  suggestions,
  onSuggestion,
}: QuestionInputProps) {
  const empty = value.trim().length === 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!empty && !loading) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline. Ignore Enter while an IME is composing.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!empty && !loading) onSubmit();
    }
  }

  return (
    <div className="space-y-4">
      <Card className="gap-0 rounded-2xl p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <Textarea
            id="question"
            name="question"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_QUESTION_LENGTH}
            rows={3}
            placeholder="Ask anything about lessons, coaching, feedback, or your account..."
            className="max-h-60 min-h-28 resize-none rounded-t-2xl rounded-b-none border-0 bg-transparent px-4 pt-4 pb-2 text-base leading-7 shadow-none focus-visible:ring-0"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-1 pb-4">
            <div className="flex min-h-9 items-center gap-3 text-xs text-muted-foreground" aria-live="polite">
              {loading ? (
                <span role="status" className="flex items-center gap-2 text-sm text-foreground/80">
                  <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
                  Searching documents and generating an answer...
                </span>
              ) : (
                <>
                  <span className="hidden sm:inline">Enter to ask · Shift+Enter for a new line</span>
                  {value.length > MAX_QUESTION_LENGTH * 0.8 && (
                    <span>
                      {value.length}/{MAX_QUESTION_LENGTH}
                    </span>
                  )}
                </>
              )}
            </div>

            <Button
              type="submit"
              disabled={empty || loading}
              className="h-11 rounded-[10px] px-5 text-[15px] font-medium transition-colors"
            >
              Ask question
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="try-asking" className="space-y-2.5">
        <h2 id="try-asking" className="text-sm font-medium text-muted-foreground">
          Try asking
        </h2>
        <ul className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                disabled={loading}
                onClick={() => onSuggestion(suggestion)}
                className="min-h-10 rounded-full border bg-card px-3.5 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
