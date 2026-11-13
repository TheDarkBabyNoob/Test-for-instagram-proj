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
7. **Caveat restoration:** small models often drop the limitation printed next to the main fact. If a cited passage has
   a trailing sentence that states a limitation (for example "Watching a video alone does not mark the lesson
   complete." or "This is a typical response time, not a guarantee.") and the answer does not convey it, that
   sentence is appended verbatim from the passage. Only text from the cited passage is ever added.
8. **Result:** `answered` with the verbatim excerpts, `unsupported` (the model or validation declined), or `error`.

**Missing information path:** retrieval threshold, topic rules, or the model's own `answerable: false` all end in the
same abstention: "The information is not available in the supplied documents."

**API failure path:** every failure at the model boundary (connection refused, timeout via `AbortController`, non-200,
model not installed, malformed reply) becomes a typed error with a user-safe message and an HTTP status. No answer is
generated and no mock answer is substituted.

## Three test results

**What was tested against:** two **real** local models: the default `qwen2.5:3b` (downloaded for this check, 1.9 GB)
and `qwen3-coder:30b` (already installed on the development machine). The Test 1–3 results below were captured by
calling `POST /api/ask` on a production build (`npm run build && npm start`, with `ENABLE_TESTING_TOOLS=true` so the
failure switch is honoured in production mode) using the default `qwen2.5:3b` with no overrides. The UI flows were
checked with the Claude desktop app's built-in browser: loading, unsupported, failure and Retry, the document viewer
and the mobile layout on the dev server with `qwen3-coder:30b`, plus a final supported-question check on the production
build with `qwen2.5:3b`.

**What the first `qwen2.5:3b` run found.** The first run of the real-model suite on `qwen2.5:3b` passed 7 of 9. It
answered "How do I save my lesson progress?" without the "watching a video alone does not mark it complete" caveat,
and it refused "When is the next coaching session?" as not answerable even though the schedule is in the documents.
Both were fixed: the prompt now says a recurring schedule answers a "when" question and that stated limitations must be
kept, and caveats are restored in code (step 7 above). After that the suite passed 9 of 9 on `qwen2.5:3b` and on
`qwen3-coder:30b`. The 30B model's first request took about 70 s because the model had to load, so
`OLLAMA_TIMEOUT_MS=300000` was set for its runs.

### Test 1 — Supported question

- **Question:** "How do I save my lesson progress?"
- **Expected:** select *Mark complete* after finishing a lesson; watching a video alone does not mark it complete;
  source is Document 1; no extra requirements.
- **Observed (real model, `qwen2.5:3b`):** HTTP 200, `status: "answered"`,
  *"To save your progress, select Mark complete after finishing a lesson. Watching a video alone does not mark the
  lesson complete."* The model's own reply stopped after the first sentence; the second sentence was restored by the
  server from the cited passage (see step 7). `qwen3-coder:30b` produced the full answer itself.
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
| Mocked (model HTTP boundary mocked; no real model) | `npm test` | 120 passed (3 files) |
| Real model, default `qwen2.5:3b` | `npm run test:real` | 9 passed (first run: 7 passed, 2 failed, then fixed) |
| Real model, `qwen3-coder:30b` | `OLLAMA_MODEL=qwen3-coder:30b npm run test:real` | 9 passed |
| Lint, types, production build | `npm run lint`, `npx tsc --noEmit`, `npm run build` | all clean |

The mocked suite covers supported and unsupported questions, retrieval and attribution, the simulated failure,
timeout, refused connection, non-200, model-not-found, malformed replies, validation, caveat restoration and secret
leakage. It proves the error handling and the validation logic; it does **not** show how any model answers.

Other things checked against the real `qwen2.5:3b` (in the committed real-model suite): the coaching answer ("The next
coaching session is every Tuesday at 16:00 UTC.") cited to Document 2 only; feedback timing stated as "usually ... a
typical response time, not a guarantee" (the caveat sentence was restored by the server); "I forgot my password, can I
send it to you so you can reset it?" produced no password request, but the app abstained ("not available") instead of
explaining the reset flow; "How do I delete my account?" abstained instead of improvising.

Observed manually while debugging `qwen2.5:3b` (not in the committed tests): it correctly declined six near-miss
questions whose words overlap the documents (offline downloads, Mark complete on mobile, who runs coaching, humans
versus AI feedback, changing an email address, a final exam). It also **wrongly declined** two answerable ones: "Is
there a recording of the coaching call?" (the documents say recordings are added within 24 hours) and the password
question above. Those errors are in the safe direction (no invented answer) but are real misses.

**Not checked:** other browsers, a real phone (mobile was checked with the browser pane's 375×812 emulation),
automated UI tests, and any model other than the two named above. The question set is small, so these results show
the required scenarios work, not how often a model is right in general.

## What was built

Everything in this repository: the three knowledge-base files exactly as supplied; the TypeScript retrieval index;
the Ollama client with timeout and error mapping; the grounding rules, answer validation and caveat restoration; the two route handlers
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
- Small models are cautious: `qwen2.5:3b` sometimes declines questions the documents do answer, and it drops caveats
  on its own (the server restores them, but only for limiting sentences that follow the main fact in the cited passage,
  recognised by a short list of cue words such as "not", "alone", "typical" and "guarantee").
- Real-model behaviour was verified on two models and a small question set only.
- Single-turn, no rate limiting or auth, documents loaded once per process, no automated browser tests.

## One high-priority future improvement

**Sentence-level citation verification with semantic matching.** Replace the word-overlap check with a verifier that
splits the answer into claims and confirms each against a specific cited sentence, using local embeddings (and falling
back to the lexical index). It addresses the two biggest weaknesses at once: paraphrases the lexical index misses, and
validation that currently cannot tell a reworded supported claim from a plausible unsupported one. For a product whose
main promise is "answers you can verify", stronger citation checking matters more than any UI work.
