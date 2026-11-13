# Walkthrough

## What works

- A single-page assistant for the fictional BrightPath Learn platform. A question goes to a server-side pipeline
  that answers **only** from three supplied documents and returns the supporting passage(s) verbatim.
- **Three outcomes are kept visibly distinct:** an answer with sources, an "Information not available" state (with a
  `mailto:` link to support for pricing, refunds and job placement), and a model-failure error with a Retry button.
- Real model health: the sidebar status comes from a server-side check of the Ollama server and the configured model.
- A "Simulate API failure" control (sidebar → Testing tools) that triggers the same error path as a real outage,
  available only in development or when `ENABLE_TESTING_TOOLS=true`.
- Responsive layout (desktop sidebar, mobile drawer), keyboard support (Enter sends, Shift+Enter adds a line),
  loading, empty and error states, and a document viewer that highlights the cited passage.

## How it works

1. **Question** → validated on the server (non-empty, at most 500 characters).
2. **Out-of-scope topics:** pricing, refunds and job placement are detected by keyword rules because Document 3 says
   it does not cover them. The app answers "not available", refers to support, and cites Document 3's own statement.
   The model is not called.
3. **Retrieval:** each line of each document is a passage. A TF-IDF index (with light stemming and a small synonym
   table) ranks passages by cosine similarity with the question.
4. **Relevance check:** if even the best passage scores below a threshold, the app abstains without calling the model.
5. **Grounded generation:** the top three passages and the question go to Ollama's `/api/chat` with a strict system
   prompt, temperature 0.1 and a JSON schema (`answerable`, `source_ids`, `answer`).
6. **Validation:** the reply is accepted only if it cites real retrieved passages that overlap the answer, adds no new
   numbers, email addresses or links, reuses mostly words from the evidence, and does not ask for a password.
7. **Result:** `answered` with the verbatim excerpts, `unsupported` (the model or validation declined), or `error`.

**Missing information path:** retrieval threshold, topic rules, or the model's own `answerable: false` all end in the
same abstention: "The information is not available in the supplied documents."

**API failure path:** every failure at the model boundary (connection refused, timeout via `AbortController`, non-200,
model not installed, malformed reply) becomes a typed error with a user-safe message and an HTTP status. No answer is
generated and no mock answer is substituted.

## Three test results

**What was tested against:** a **real** local model, but **not the preferred one.** The only model installed on the
development machine was `qwen3-coder:30b`, so every real-model result below was observed with it
(`OLLAMA_MODEL=qwen3-coder:30b`). The default `qwen2.5:3b` was **not downloaded or run**, so its behaviour is untested.
Results were captured by calling `POST /api/ask` on a production build (`npm run build && npm start`, with
`ENABLE_TESTING_TOOLS=true` so the failure switch is honoured in production mode); the UI flows were checked in the
dev server using the Claude desktop app's built-in browser. The first request took about 70 s
because the 30B model had to load, so `OLLAMA_TIMEOUT_MS=300000` was set for these runs.

### Test 1 — Supported question

- **Question:** "How do I save my lesson progress?"
- **Expected:** select *Mark complete* after finishing a lesson; watching a video alone does not mark it complete;
  source is Document 1; no extra requirements.
- **Observed (real model):** HTTP 200, `status: "answered"`,
  *"To save your lesson progress, select Mark complete after finishing a lesson. Watching a video alone does not mark
  the lesson complete."*
- **Source shown:** Document 1 — Getting started (`document-1`): "To save your progress, select Mark complete after
  finishing a lesson. Watching a video alone does not mark the lesson complete."
- **Status: PASS**

### Test 2 — Unsupported question

- **Question:** "What is BrightPath Learn's refund policy?"
- **Expected:** the information is not available; refer to support; cite Document 3; no invented policy.
- **Observed:** HTTP 200, `status: "unsupported"`, *"The information is not available in the supplied documents. They do
  not specify BrightPath Learn's refund policy. Please contact support@brightpath.example for assistance."* This path
  does not call the model (topic rule), so it does not depend on the model's behaviour.
- **Source shown:** Document 3 — Account help (`document-3`): "This document does not contain pricing, refund rules or
  job placement promises. For those questions, say the information is not available in the supplied documents and
  refer the member to support."
- **Status: PASS**
- **Extra case, genuinely absent fact:** "Does BrightPath Learn have a mobile app?" → `unsupported`, answer
  *"The information is not available in the supplied documents."*, no sources (no passage was relevant enough, so the
  model was not called). **PASS**

### Test 3 — API failure

- **Question:** "When is the next coaching session?" with **Simulate API failure** enabled.
- **Expected:** a clear model-unavailable error, no crash, no fabricated answer.
- **Observed:** HTTP 503, `{"status":"error","code":"MODEL_UNAVAILABLE","message":"The AI model is currently unavailable."}`.
  In the UI: an "AI model unavailable" card ("We couldn't connect to the language model. Check that Ollama is running
  and try again."), the text "No answer was generated", and a Retry button. Retry failed again while the switch was
  on; with the switch off, Retry returned a real answer ("... every Tuesday at 16:00 UTC", cited to Document 2).
- **Status: PASS**
- **Real (not simulated) failures also observed:** `OLLAMA_BASE_URL=http://localhost:9` → HTTP 503 `MODEL_UNAVAILABLE`
  and health `SERVER_UNREACHABLE`; `OLLAMA_MODEL=does-not-exist:1b` → HTTP 503 `MODEL_NOT_FOUND` and health
  `MODEL_NOT_INSTALLED`. The server log kept the internal detail; the response did not.

### Automated tests

| Suite | Command | Result |
| --- | --- | --- |
| Mocked (model HTTP boundary mocked; no real model) | `npm test` | 114 passed (3 files) |
| Real model (`qwen3-coder:30b`) | `npm run test:real` | 9 passed |
| Lint, types, production build | `npm run lint`, `npx tsc --noEmit`, `npm run build` | all clean |

The mocked suite covers supported and unsupported questions, retrieval and attribution, the simulated failure,
timeout, refused connection, non-200, model-not-found, malformed replies, validation and secret leakage. It proves the
error handling and the validation logic; it does **not** show how any model answers.

Other things checked against the real model: coaching answer cited to Document 2 only; feedback timing stated as
"usually ... a typical response time, not a guarantee"; "I forgot my password, can I send it to you so you can reset
it?" produced no password request, but the app abstained ("not available") instead of explaining the reset flow, which
is the conservative behaviour noted under limitations; "How do I delete my account?" abstained instead of improvising.

**Not checked:** `qwen2.5:3b` (never downloaded), other browsers, a real phone (mobile was checked with the browser
pane's 375×812 emulation), and automated UI tests.

## What was built

Everything in this repository: the three knowledge-base files exactly as supplied; the TypeScript retrieval index;
the Ollama client with timeout and error mapping; the grounding rules and answer validation; the two route handlers
(`/api/ask`, `/api/health`); the responsive UI (shadcn/ui primitives, Tailwind, the specified colour system); the
Vitest suites (mocked and real-model); and the README and this walkthrough.

## AI coding tools used

**Claude Code** (Anthropic's AI coding assistant) was used to plan and write the implementation, tests and
documentation from the assessment brief. The code was not handwritten. Verification (lint, type check, tests, build,
real-model runs, browser checks) was run with the same tool, and the results above are the outputs it observed.

## Known limitations

- Lexical retrieval misses paraphrases outside its small synonym table and sometimes ranks close passages almost
  equally. The top three go to the model, so a near-tie is usually harmless, but it is a real weakness.
- Validation is heuristic (word overlap, no new numbers/links, no password requests); it reduces unsupported answers
  but cannot prove an answer is correct.
- Keyword topic rules are coarse: a mixed question ("reset my password and what's the refund policy?") gets only the
  out-of-scope message, and words like "free" count as pricing.
- Abstention is conservative: a rejected model reply becomes "not available" even when part of it was fine.
- Real-model behaviour is only verified for one model that is not the default.
- Single-turn, no rate limiting or auth, documents loaded once per process, no automated browser tests.

## One high-priority future improvement

**Sentence-level citation verification with semantic matching.** Replace the word-overlap check with a verifier that
splits the answer into claims and confirms each against a specific cited sentence, using local embeddings (and falling
back to the lexical index). It addresses the two biggest weaknesses at once: paraphrases the lexical index misses, and
validation that currently cannot tell a reworded supported claim from a plausible unsupported one. For a product whose
main promise is "answers you can verify", stronger citation checking matters more than any UI work.
