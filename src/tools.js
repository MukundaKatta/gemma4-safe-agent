// Tool definitions for the Gemma 4 research agent.
// Each tool is:
//   1) wrapped in `traceTool` so agentsnap can record the call
//   2) wrapped in `vet` so agentvet rejects bad args before the side effect runs
// The whole agent run happens inside an agentguard `firewall` so any fetch()
// that escapes the allowlist throws PolicyViolation.
import { traceTool } from '@mukundakatta/agentsnap';
import { vet, adapters as vetAdapters } from '@mukundakatta/agentvet';

const MOCK_PAGES = {
  'https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback':
    'Reinforcement learning from human feedback (RLHF) is a technique that uses human preferences as a reward signal to fine-tune models.',
  'https://en.wikipedia.org/wiki/Gemma_(language_model)':
    'Gemma is a family of lightweight open models from Google DeepMind, derived from the same research used to build Gemini.',
};

async function rawFetchUrl({ url }) {
  if (process.env.AGENT_MOCK === '1') {
    return MOCK_PAGES[url] ?? `[mock: no canned page for ${url}]`;
  }
  const r = await fetch(url, { headers: { 'user-agent': 'gemma4-safe-agent/0.1' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const html = await r.text();
  return stripHtml(html).slice(0, 4000);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const fetchUrlVetted = vet({
  name: 'fetch_url',
  schema: vetAdapters.shape({ url: 'string' }),
  fn: rawFetchUrl,
});

export const fetch_url = traceTool('fetch_url', fetchUrlVetted);

// Local "summarize" tool. Just here so the agent has more than one tool to
// pick between — exercises agentsnap's tool-ordering diff.
async function rawSummarize({ text, max_words = 40 }) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max_words) return text;
  return words.slice(0, max_words).join(' ') + '...';
}

const summarizeVetted = vet({
  name: 'summarize',
  schema: vetAdapters.shape({ text: 'string', max_words: 'number?' }),
  fn: rawSummarize,
});

export const summarize = traceTool('summarize', summarizeVetted);

export const TOOLS = {
  fetch_url: { fn: fetch_url, description: 'Fetch a URL. Pass { "url": "https://..." }.' },
  summarize: { fn: summarize, description: 'Summarize text. Pass { "text": "...", "max_words": 40 }.' },
};
