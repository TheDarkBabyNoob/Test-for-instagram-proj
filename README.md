# BrightPath Learn — AI Knowledge Assistant

A small, locally runnable question-answering app for a **fictional** learning platform, BrightPath Learn.
Ask a question in plain language and get an answer grounded **only** in three supplied documents, together with the
exact passage(s) that support it. When the documents don't contain the answer, the app says so instead of guessing.
When the language model is unavailable, it shows a clear error instead of inventing an answer.

- **No API key, no database, no cloud.** The language model runs locally through [Ollama](https://ollama.com).
- Next.js (App Router) + TypeScript for both UI and server routes. Retrieval is a small custom TF-IDF index.
- Source citations are verbatim passages from the files in [`documents/`](documents).

> The three documents are fictional. Nothing in this repository is real BrightPath policy.

## Contents

1. [Quick start](#quick-start)
2. [Install Ollama and the model](#install-ollama-and-the-model)
3. [Configuration](#configuration)
4. [Using the app](#using-the-app)
5. [Simulating an API failure](#simulating-an-api-failure)
6. [Tests and verification](#tests-and-verification)
7. [Architecture](#architecture)
8. [Technology choices](#technology-choices)
9. [API reference](#api-reference)
10. [Known limitations](#known-limitations)
11. [Possible improvements](#possible-improvements)

## Quick start

Requirements: **Node.js 20.19 or newer** (an LTS release) and **Ollama** (next section).

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The sidebar's **Model status** shows *Connected* once Ollama is running and the
configured model is installed (this is a real server-side check, not a guess).

The same commands work in Windows PowerShell, macOS and Linux shells.

## Install Ollama and the model

| OS | Install |
| --- | --- |
| Windows (PowerShell) | `winget install Ollama.Ollama` (or use the installer from <https://ollama.com/download>) |
| macOS | `brew install ollama` (or the installer from <https://ollama.com/download>) |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` |

The Windows and macOS desktop apps start the Ollama server automatically. Otherwise start it yourself in a separate terminal:

```bash
ollama serve
```

Download the preferred model (about 2 GB):

```bash
ollama pull qwen2.5:3b
```

Check that the server and model are available:

```bash
ollama list
```

## Configuration

Configuration is read **on the server only** from environment variables. Nothing is exposed to the browser and no
key is needed. The defaults below already work after `ollama pull qwen2.5:3b`, so creating a file is optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where the Ollama server listens |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Model used for answers |
| `OLLAMA_TIMEOUT_MS` | `60000` | Abort and report a timeout after this long. A large model's first request loads it into memory and can take longer; raise this if needed |
| `ENABLE_TESTING_TOOLS` | unset | Set to `true` to show the failure-simulation control in a **production** build (always on under `npm run dev`) |

To persist settings, create a `.env.local` file in the project root (it is git-ignored):

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
```

Or set variables for a single run.

PowerShell:

```powershell
$env:OLLAMA_MODEL = "llama3.2:3b"; npm run dev
```

macOS / Linux:

```bash
OLLAMA_MODEL=llama3.2:3b npm run dev
```

## Using the app

1. Type a question (Enter sends, Shift+Enter adds a new line), or click one of the **Try asking** chips.
2. The app shows *"Searching documents and generating an answer..."* while it works. Your question is kept and
   duplicate submissions are blocked.
3. You get one of three outcomes:
   - **Answer** with **Supporting sources**: each source card shows the document title, its identifier and the
     exact excerpt. **View document** opens the full text with that excerpt highlighted.
   - **Information not available**: the documents don't contain the answer. For pricing, refunds and job
     placement, which Document 3 says it does not cover, the message points to
     [support@brightpath.example](mailto:support@brightpath.example) and cites Document 3's own statement.
   - **AI model unavailable** (or timeout / unexpected response): a visually distinct error with a **Retry** button.
     No answer is shown in this case.
4. The sidebar lists the three documents; click one to read its full text.

### How source citations work

Citations are never written by the model. Every source is a passage the retrieval step actually found, copied
verbatim from the document file. The model is asked which numbered passages it used, and the server then keeps a
passage only if the answer genuinely overlaps with its text. Passages that were retrieved but don't support the
answer are not shown. The `score` field in the API response is a lexical similarity used for ranking. It is not a
confidence and it is not displayed in the UI.

Small models often leave out a limitation printed next to the main fact (such as "Watching a video alone does not
mark the lesson complete." or "This is a typical response time, not a guarantee."). When that happens the server
appends that sentence, word for word, from the cited passage. It only ever adds text that exists in a cited source.

## Simulating an API failure

The failure switch exists so a reviewer can see the error path without disconnecting anything. It is a developer
tool: available under `npm run dev`, and in a production build only when `ENABLE_TESTING_TOOLS=true`.

**In the UI:** open the sidebar (on mobile: the menu button), expand **Testing tools**, turn on
**Simulate API failure**, then ask a question such as *"When is the next coaching session?"*. The app shows the same
**AI model unavailable** state as a real outage, with no answer. Turn the switch off and press **Retry** to get a
real answer.

**With the API:**

```bash
curl -s -X POST http://localhost:3000/api/ask -H "Content-Type: application/json" \
  -d '{"question":"When is the next coaching session?","simulateFailure":true}'
```

```powershell
$body = '{"question":"When is the next coaching session?","simulateFailure":true}'
try { Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/ask -ContentType 'application/json' -Body $body } catch { $_.ErrorDetails.Message }
```

Expected response (HTTP 503):

```json
{ "status": "error", "code": "MODEL_UNAVAILABLE", "message": "The AI model is currently unavailable." }
```

The simulated failure is thrown at the model boundary as the same error a refused connection produces, so it goes
through exactly the same handling. In a production build without `ENABLE_TESTING_TOOLS=true` the flag is ignored.

**Real failures** can be reproduced too: stop Ollama, or start the app with `OLLAMA_BASE_URL=http://localhost:9`
(connection refused), or with `OLLAMA_MODEL=not-installed:1b` (model not found).

## Tests and verification

```bash
npm install
npm run lint          # ESLint
npm run typecheck     # npx tsc --noEmit
npm test              # Vitest: deterministic, offline, model HTTP boundary mocked
npm run build         # production build
npm start             # serve the production build on http://localhost:3000
```

### Mocked tests (`npm test`)

All of these run offline. The Ollama HTTP boundary (`fetch`) is mocked, so **none of them uses a real model**:

| File | Covers |
| --- | --- |
| `tests/retrieval.test.ts` | Document loading, exact-substring chunks, TF-IDF ranking and attribution for supported and paraphrased questions, relevance threshold, known missing-information policies |
| `tests/grounding.test.ts` | System prompt rules, strict parsing of model replies, answer validation (invented numbers/links, bad citations, password requests) |
| `tests/api.test.ts` | `POST /api/ask` and `GET /api/health`: the three required scenarios, timeout, refused connection, non-200, model not found, malformed replies, input validation, no leakage of internals, simulation gating |

### Real-model tests (`npm run test:real`)

These call a live Ollama server and are **kept separate** because they are slow and depend on the installed model.
They fail loudly (rather than skipping) if Ollama or the model is missing.

```bash
npm run test:real
```

Use another installed model with `OLLAMA_MODEL`, and a longer timeout if the first request has to load a large model.

PowerShell: `$env:OLLAMA_MODEL = "your-model"; $env:OLLAMA_TIMEOUT_MS = "300000"; npm run test:real`
macOS / Linux: `OLLAMA_MODEL=your-model OLLAMA_TIMEOUT_MS=300000 npm run test:real`

See [WALKTHROUGH.md](WALKTHROUGH.md) for what was actually observed, including which model was used.

## Architecture

```
Browser (React, client component)
   │  POST /api/ask { question, simulateFailure? }        GET /api/health
   ▼                                                              │
Next.js route handlers (server only) ───────────────────────────────┘
   │
   ├─ validate input (non-empty, ≤ 500 chars)
   ├─ known out-of-scope topic? (pricing / refund / job placement)  ──► "unsupported" + Document 3 statement
   ├─ retrieve: TF-IDF + cosine over passages of documents/*.txt
   ├─ best score below threshold?                                   ──► "unsupported" (no model call)
   ├─ Ollama /api/chat (temperature 0.1, JSON-schema output, AbortController timeout)
   ├─ validate the reply against the retrieved passages
   │     (cited passages must overlap the answer; no new numbers / emails / links;
   │      wording must mostly come from the evidence; no password requests)
   ├─ restore caveats the model left out (verbatim sentences from the cited passage only)
   └─ "answered" + verbatim sources     or     "unsupported"     or     structured "error"
```

| Path | Responsibility |
| --- | --- |
| `app/api/ask/route.ts`, `app/api/health/route.ts` | HTTP layer, validation, user-safe error mapping |
| `lib/documents.ts` | Loads the three `.txt` files (server only) |
| `lib/retrieval.ts` | Paragraph chunking, tokenising, TF-IDF vectors, cosine similarity, top-k |
| `lib/grounding.ts` | Missing-information topics, reply parsing, answer validation, caveat restoration |
| `lib/prompt.ts` | Dedicated system prompt and structured-output schema |
| `lib/ollama.ts` | Native-`fetch` client, timeout, error mapping, health check |
| `lib/ask.ts` | Orchestrates the whole pipeline |
| `components/` | Assistant UI built from shadcn/ui primitives |
| `documents/` | The knowledge base (the only source of truth) |

Safeguards against unsupported answers are layered, because no single one is reliable: a retrieval threshold,
explicit handling for topics the documents say they don't cover, a strict prompt that lets the model abstain, and
validation of what the model returned. These reduce the risk of unsupported answers. **They do not guarantee that
an answer is correct**, and a similarity threshold on its own would not prevent hallucination.

## Technology choices

| Choice | Why |
| --- | --- |
| Next.js App Router + TypeScript (strict) | One codebase and one process for UI and API; route handlers keep Ollama and configuration server-side |
| Ollama + `qwen2.5:3b` | A real model that runs locally with no API key; small enough for a laptop |
| Native `fetch` + `AbortController` | No HTTP client dependency; enforces a hard timeout |
| JSON-schema structured output | Lets the server read `answerable`, `source_ids` and `answer` reliably instead of parsing prose |
| Custom TF-IDF + cosine (TypeScript) | Three tiny documents: a small self-contained index is easier to audit than a vector database or embeddings API |
| Tailwind CSS + shadcn/ui + Lucide | Accessible primitives with a consistent, restrained design system |
| Geist via the `geist` package | Self-hosted font, so builds work offline |
| Vitest | Fast TypeScript-native tests with easy `fetch` mocking |

## API reference

`POST /api/ask` with `{ "question": string, "simulateFailure"?: boolean }` (question: 1–500 characters).

| `status` | HTTP | Body |
| --- | --- | --- |
| `answered` | 200 | `answer`, `sources[]` (`documentId`, `documentTitle`, `documentNumber`, `excerpt`, `score`) |
| `unsupported` | 200 | `answer` (abstention), `sources[]` (empty, or Document 3's out-of-scope statement) |
| `error` | 400 / 502 / 503 / 504 / 500 | `code`, `message` |

Error codes: `INVALID_REQUEST` (400), `MODEL_UNAVAILABLE` (503), `MODEL_NOT_FOUND` (503), `MODEL_TIMEOUT` (504),
`MODEL_BAD_RESPONSE` (502), `INTERNAL_ERROR` (500). Messages are generic; URLs, stack traces and raw model errors
stay in the server log.

`GET /api/health` returns `{ status: "connected" | "unavailable", model, reason?, testingTools }` after asking
Ollama whether the configured model is installed.

## Known limitations

- **Lexical retrieval.** Matching is by shared words (plus light stemming and a small synonym table). Wording the
  index has never seen can be missed, and some questions produce near-ties between passages (for example
  "When is the next coaching session?" ranks the session-link passage and the schedule passage almost equally; both
  reach the model, but the order is not meaningful).
- **Validation is heuristic.** It catches invented numbers/links, bad citations and password requests, but a model can
  still produce a wrong answer built from supported words.
- **Topic rules are coarse.** A question that mentions pricing, refunds or job placement is answered with the
  out-of-scope message even if it also contains an answerable part. Keyword rules can also over-trigger (for example,
  "free" is treated as a pricing word).
- **Conservative abstention.** When validation rejects a model reply, the user sees "not available" rather than a
  partial answer. For instance, asking whether you can send your password to support abstains instead of explaining
  the reset flow.
- **Small models are cautious.** With the default `qwen2.5:3b`, the required scenarios pass, but the model sometimes
  declines a question the documents do answer (for example, whether a coaching recording exists). That fails safe,
  but it is a real miss. See WALKTHROUGH.md for exactly what was verified and on which models.
- Single-turn only (no conversation memory), no rate limiting or authentication (out of scope), and the documents are
  loaded once per server process, so restart after editing them.
- No automated browser tests; the UI was checked manually.

## Possible improvements

- Semantic retrieval with local embeddings (for example an Ollama embedding model), keeping TF-IDF as a fallback,
  to handle paraphrases the lexical index misses.
- Sentence-level citation checks: verify each claim in the answer against a specific cited sentence.
- Playwright tests for the UI flows (supported, unsupported, failure and retry).
- Streaming responses for faster perceived latency.
