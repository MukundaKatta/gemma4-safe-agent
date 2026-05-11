# gemma4-safe-agent

> Submission for the [Gemma 4 DEV Challenge](https://dev.to/challenges/google-gemma-2026-05-06), Build track.

A tiny research agent powered by **Gemma 4 (e2b)** running locally on Ollama, hardened by five zero-dependency open-source libraries:

| Lib | Role here |
|---|---|
| [`agentfit`](https://www.npmjs.com/package/@mukundakatta/agentfit) | Trim chat history to the 2B context window before every turn |
| [`agentguard`](https://www.npmjs.com/package/@mukundakatta/agentguard) | Network egress firewall: only Wikipedia + arXiv allowed |
| [`agentsnap`](https://www.npmjs.com/package/@mukundakatta/agentsnap) | Snapshot the tool-call trace, fail CI on regressions |
| [`agentvet`](https://www.npmjs.com/package/@mukundakatta/agentvet) | Reject tool calls with bad arg shapes before they run |
| [`agentcast`](https://www.npmjs.com/package/@mukundakatta/agentcast) | Force the final answer into a valid JSON schema, retry on miss |

The headline idea: **small open models become production-usable when the surrounding scaffolding is right.** Gemma 4 e2b picks tools fine. The cliff is reliability (malformed JSON, hallucinated args, runaway fetches). This repo is a working pattern for closing that gap.

## Quickstart

```bash
# 1. Install Ollama + pull Gemma 4
ollama pull gemma4:e2b      # or :4b, :26b, :31b

# 2. Run the demo
npm install
npm run demo -- "What is RLHF?"
```

Output:

```json
{
  "final": "RLHF is a technique that uses human preferences as a reward signal to fine-tune language models.",
  "sources": ["https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"],
  "steps": 2
}
```

## Run without Ollama (stub LLM)

For CI / demos when Ollama isn't available, the agent loop accepts an injected `llm` function. The stub example proves the whole pipeline runs end-to-end:

```bash
AGENT_MOCK=1 node examples/run-stub.js
```

## What each lib actually does in the run

### `agentfit`: context trimming before each turn

```js
const fitted = fit(messages, {
  maxTokens: 4096,
  preserveSystem: true,
  preserveLastN: 2,
  strategy: 'drop-oldest',
});
const raw = await ollamaChat(fitted.messages);
```

`gemma4:e2b` has a small context window. As the tool-call trace grows, older user/assistant pairs are dropped while the system prompt and most recent turns stay protected.

### `agentguard`: network firewall around the whole run

```js
const POLICY = policy({
  network: { allow: ['en.wikipedia.org', 'arxiv.org', '127.0.0.1', 'localhost'] },
  budget: { maxRequests: 30 },
  violations: 'throw',
});

await firewall(POLICY, () => run(question));
```

If Gemma 4 ever decides to fetch `https://attacker.example/exfil?data=...` (prompt-injection style), it throws `PolicyViolation` before the request hits the wire. Verified in the negative test in this repo.

### `agentvet`: tool-arg validation

```js
const fetchUrlVetted = vet({
  name: 'fetch_url',
  schema: vetAdapters.shape({ url: 'string' }),
  fn: rawFetchUrl,
});
```

If the model hallucinates `{ url: 12345 }` or forgets the field, the tool never runs. The error carries a feedback string the next turn can read.

### `agentsnap`: tool-call snapshot

```js
const search = traceTool('fetch_url', vet({ ... }));
const trace = await record(() => run('What is RLHF?'));
await expectSnapshot(trace, 'test/__snapshots__/rlhf.snap.json');
```

The baseline records that for "What is RLHF?" the agent calls `fetch_url` once with a specific URL. If a model swap (gemma4:e2b → gemma4:e4b) or prompt change causes the agent to skip the fetch and hallucinate the answer instead, the test fails with a colored diff.

### `agentcast`: final-answer JSON enforcement

```js
return cast({
  llm: async (msgs) => ollamaChat([...history, ...msgs]),
  validate: castAdapters.shape({ final: 'string', sources: 'array' }),
  prompt: 'Restate ONLY your final answer as JSON...',
  maxRetries: 2,
});
```

The whole reason this repo works with a small model. `gemma4:e2b` will, more often than you'd like, wrap JSON in `Sure! Here's the answer:` or in ` ```json ` fences, or forget a field. `cast()` extracts what it can, validates, and feeds the validation error back as a retry message.

## Why Gemma 4 (e2b) specifically

Gemma 4 ships in four sizes; this repo defaults to **`gemma4:e2b`** (edge 2B) because:

- Runs on a laptop in a couple of GB of RAM, no API key.
- Hardest variant to keep reliable, which makes the safety scaffolding load-bearing instead of cosmetic.
- The same agent code works unmodified against `gemma4:e4b`, `gemma4:26b` (MoE), and `gemma4:31b` (dense): set `GEMMA_MODEL` and re-run.

The point of the build is to show that you don't need a 70B-class model for a usable tool-using agent. You need the right scaffolding around a small one.

## Layout

```
build/
  package.json
  src/
    agent.js          # main loop: fit, llm, parse, tool / final
    tools.js          # fetch_url, summarize (vet + traceTool wrapped)
    ollama.js         # tiny chat() wrapper
  examples/
    run-demo.js       # real run against Ollama
    run-stub.js       # scripted LLM, works without Ollama
  test/
    snapshot.test.js  # agentsnap regression test
```

## License

MIT.
