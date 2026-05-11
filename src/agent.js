// The Gemma 4 research agent loop.
//
// Why this shape? Small open models (Gemma 4 2B/4B) are reasonable at picking
// the right tool but unreliable at strict JSON. We get reliability from the
// agent-stack rather than from a bigger model:
//
//   agentfit   — trim history to the 2B context window before each call
//   agentguard — only allow fetches to a small set of known-good hosts
//   agentvet   — reject tool calls with the wrong arg types before they run
//   agentcast  — make the final answer pass a schema or retry
//   agentsnap  — record the trace so a regression in tool-use shows up in CI
import { fit } from '@mukundakatta/agentfit';
import { cast, adapters as castAdapters } from '@mukundakatta/agentcast';
import { TOOLS } from './tools.js';
import { chat as ollamaChat } from './ollama.js';

const SYSTEM_PROMPT = `You are a small research agent powered by Gemma 4.
You have two tools:
  - fetch_url(url): fetches a web page
  - summarize(text, max_words): shortens text

To use a tool, reply with ONLY one JSON object on a single line:
  {"tool": "fetch_url", "args": {"url": "https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"}}

When you have enough information, reply with ONLY:
  {"final": "<your one-paragraph answer here>", "sources": ["https://..."]}

Do not include any other text. No prose, no fences, no "Sure here you go".`;

const FINAL_SHAPE = castAdapters.shape({
  final: 'string',
  sources: 'array',
});

const MAX_STEPS = 6;
const CONTEXT_BUDGET = 4096; // safe for gemma4:2b / 4b

export async function run(question, { llm = ollamaChat } = {}) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];
  const sources = new Set();

  for (let step = 0; step < MAX_STEPS; step++) {
    // Trim history before each turn so we never blow the 2B context.
    const fitted = fit(messages, {
      maxTokens: CONTEXT_BUDGET,
      model: 'gemma4', // falls back to default estimator, fine for a budget
      preserveSystem: true,
      preserveLastN: 2,
      strategy: 'drop-oldest',
      onOverBudget: 'return-partial',
    });

    const raw = await llm(fitted.messages);
    const action = parseAction(raw);

    if (action.kind === 'tool') {
      const spec = TOOLS[action.tool];
      if (!spec) {
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: `Unknown tool "${action.tool}". Pick one of: ${Object.keys(TOOLS).join(', ')}` });
        continue;
      }
      let result;
      try {
        result = await spec.fn(action.args);
        if (action.tool === 'fetch_url' && action.args?.url) sources.add(action.args.url);
      } catch (err) {
        result = `tool error: ${err?.message ?? String(err)}`;
      }
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: `tool_result for ${action.tool}: ${truncate(String(result), 800)}` });
      continue;
    }

    if (action.kind === 'parse_error') {
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: 'Reply with a single JSON object only. No prose, no fences.' });
      continue;
    }

    // Final answer reached — pass through agentcast for shape enforcement.
    const answer = await castWithHistory(messages, raw, FINAL_SHAPE, llm);
    // Merge sources discovered via fetch_url with whatever the model returned.
    const merged = new Set([...(answer.sources ?? []), ...sources]);
    return { ...answer, sources: [...merged], steps: step + 1 };
  }

  throw new Error(`Agent exceeded ${MAX_STEPS} steps without producing a final answer`);
}

function parseAction(raw) {
  const text = raw.trim();
  // Drop common code fences a small model loves to add.
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === 'object' && obj.tool && obj.args && typeof obj.args === 'object') {
      return { kind: 'tool', tool: obj.tool, args: obj.args };
    }
    if (obj && typeof obj.final === 'string') {
      return { kind: 'final', value: obj };
    }
    return { kind: 'parse_error' };
  } catch {
    return { kind: 'parse_error' };
  }
}

// Wrap the final answer step in agentcast so a malformed JSON shape kicks the
// model into a retry instead of failing the whole run.
async function castWithHistory(history, lastAssistant, validate, llm) {
  return cast({
    llm: async (msgs) => llm([...history, ...msgs]),
    validate,
    prompt: 'Restate ONLY your final answer as JSON: {"final": "...", "sources": ["..."]}',
    system: 'Reply with one JSON object. No prose, no fences.',
    maxRetries: 2,
  });
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '...' : s;
}
