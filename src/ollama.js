// Thin wrapper around the Ollama client so the rest of the code stays small.
// Gemma 4 must already be pulled locally: `ollama pull gemma4:2b` (or 4b/26b/31b).
import { Ollama } from 'ollama';

const ollama = new Ollama({ host: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434' });

export const DEFAULT_MODEL = process.env.GEMMA_MODEL ?? 'gemma4:2b';

// Plain text completion. agentcast feeds a chat-shaped messages array in;
// we flatten it for Ollama's chat API.
export async function chat(messages, { model = DEFAULT_MODEL, temperature = 0 } = {}) {
  const r = await ollama.chat({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    options: { temperature },
    stream: false,
  });
  return r.message?.content ?? '';
}
