"use client";

import type { ComponentType } from "react";
import {
  CircleAlert,
  CircleCheck,
  FileText,
  FlaskConical,
  GraduationCap,
  LifeBuoy,
  LoaderCircle,
  MessagesSquare,
  Rocket,
  type LucideProps,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { HealthResponse, KnowledgeDocument } from "@/lib/types";

/** Icons are a presentation detail; the document content itself always comes from the files. */
const DOCUMENT_ICONS: Record<string, ComponentType<LucideProps>> = {
  "document-1": Rocket,
  "document-2": MessagesSquare,
  "document-3": LifeBuoy,
};

interface SidebarContentProps {
  documents: KnowledgeDocument[];
  health: HealthResponse | null;
  simulateFailure: boolean;
  onSimulateFailureChange: (value: boolean) => void;
  onOpenDocument: (documentId: string) => void;
}

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-[10px] bg-accent text-primary">
        <GraduationCap className="size-5" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold">BrightPath Learn</p>
        <p className="text-xs text-muted-foreground">AI Knowledge Assistant</p>
      </div>
    </div>
  );
}

function ModelStatus({ health }: { health: HealthResponse | null }) {
  let icon = <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />;
  let label = "Checking";
  let detail: string | null = null;
  let tone = "text-muted-foreground";

  if (health?.status === "connected") {
    icon = <CircleCheck className="size-4 text-success" aria-hidden="true" />;
    label = "Connected";
    tone = "text-success";
  } else if (health?.status === "unavailable") {
    icon = <CircleAlert className="size-4 text-warning" aria-hidden="true" />;
    label = "Unavailable";
    tone = "text-warning";
    detail =
      health.reason === "MODEL_NOT_INSTALLED"
        ? `Model not installed. Run: ollama pull ${health.model}`
        : health.reason === "SERVER_ERROR"
          ? "Ollama returned an error."
          : "Can't reach Ollama. Is it running?";
  }

  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <p className="text-xs font-medium text-muted-foreground">Model status</p>
      <div className={`flex items-center gap-2 text-sm font-medium ${tone}`}>
        {icon}
        <span>{label}</span>
      </div>
      {health && <p className="font-mono text-xs break-all text-muted-foreground">{health.model}</p>}
      {detail && <p className="text-xs leading-5 text-muted-foreground">{detail}</p>}
    </div>
  );
}

function TestingTools({
  simulateFailure,
  onChange,
}: {
  simulateFailure: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Accordion className="rounded-[10px] border bg-card px-3">
      <AccordionItem value="testing-tools" className="border-0">
        <AccordionTrigger className="items-center py-2.5 text-[13px] hover:no-underline">
          <span className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" />
            Testing tools
            {simulateFailure && (
              <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                On
              </span>
            )}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <label className="flex cursor-pointer items-start justify-between gap-3 pb-3">
            <span className="space-y-0.5">
              <span className="block text-[13px] font-medium">Simulate API failure</span>
              <span className="block text-xs leading-5 text-muted-foreground">
                While on, questions fail as if the model were unreachable. No fake answer is returned.
              </span>
            </span>
            <Switch
              checked={simulateFailure}
              onCheckedChange={onChange}
              aria-label="Simulate API failure"
              className="mt-0.5"
            />
          </label>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Shared by the desktop sidebar and the mobile drawer. */
export function SidebarContent({
  documents,
  health,
  simulateFailure,
  onSimulateFailureChange,
  onOpenDocument,
}: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col gap-5 p-5">
      <Brand />
      <Separator />

      <nav aria-labelledby="kb-heading" className="flex-1">
        <h2 id="kb-heading" className="mb-2 px-2 text-[11px] font-medium tracking-wider text-muted-foreground">
          KNOWLEDGE BASE
        </h2>
        <ul className="space-y-0.5">
          {documents.map((doc) => {
            const Icon = DOCUMENT_ICONS[doc.id] ?? FileText;
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onOpenDocument(doc.id)}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{doc.sidebarLabel}</span>
                  <span className="sr-only">: open document text</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-4">
        {health?.testingTools && (
          <TestingTools simulateFailure={simulateFailure} onChange={onSimulateFailureChange} />
        )}
        <Separator />
        <ModelStatus health={health} />
      </div>
    </div>
  );
}
