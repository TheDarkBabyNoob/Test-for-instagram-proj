import { Assistant } from "@/components/assistant";
import { loadDocuments } from "@/lib/documents";

// Render per request: documents are read from the server's file system at runtime, not frozen into the build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const documents = await loadDocuments();
  return <Assistant documents={documents} />;
}
