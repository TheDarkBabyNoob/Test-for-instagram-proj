"use client";

import { FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { KnowledgeDocument } from "@/lib/types";

interface DocumentViewerProps {
  document: KnowledgeDocument | null;
  /** Passage to highlight (an exact substring of the document), if opened from a source card. */
  highlight: string | null;
  onClose: () => void;
}

function DocumentText({ text, highlight }: { text: string; highlight: string | null }) {
  const start = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || start === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-accent px-0.5 text-foreground ring-1 ring-primary/30">{highlight}</mark>
      {text.slice(start + highlight.length)}
    </>
  );
}

/** Slide-over panel with the full, unmodified text of a source document. */
export function DocumentViewer({ document, highlight, onClose }: DocumentViewerProps) {
  return (
    <Sheet open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {document && (
          <>
            <SheetHeader className="border-b p-5 pr-12">
              <div className="flex items-center gap-2">
                <FileText className="size-5 text-primary" aria-hidden="true" />
                <SheetTitle className="text-[17px] font-semibold">
                  Document {document.number} — {document.title}
                </SheetTitle>
              </div>
              <SheetDescription className="text-sm">
                Full text of <code className="font-mono text-xs">{document.id}</code>, exactly as supplied.
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-5 text-[15px] leading-7 whitespace-pre-wrap text-foreground">
                <DocumentText text={document.text.trimEnd()} highlight={highlight} />
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
