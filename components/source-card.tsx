"use client";

import { BookOpen, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Source } from "@/lib/types";

interface SourceCardProps {
  source: Source;
  onViewDocument: (documentId: string, excerpt: string) => void;
}

/** One cited passage. The excerpt is the exact text from the source file. */
export function SourceCard({ source, onViewDocument }: SourceCardProps) {
  return (
    <Card className="gap-3 rounded-xl p-4 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <h3 className="text-sm leading-5 font-medium">
            Document {source.documentNumber} — {source.documentTitle}
          </h3>
        </div>
        <code className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {source.documentId}
        </code>
      </div>

      <blockquote className="rounded-lg border-l-2 border-primary/50 bg-muted/60 px-3 py-2.5 text-sm leading-6 text-foreground">
        <span aria-hidden="true">“</span>
        {source.excerpt}
        <span aria-hidden="true">”</span>
      </blockquote>

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-1.5 text-primary hover:bg-accent hover:text-accent-foreground"
          onClick={() => onViewDocument(source.documentId, source.excerpt)}
        >
          <BookOpen aria-hidden="true" />
          View document
          <span className="sr-only">: {source.documentTitle}</span>
        </Button>
      </div>
    </Card>
  );
}
