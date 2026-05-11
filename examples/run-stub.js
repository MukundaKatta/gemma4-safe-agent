// End-to-end demo with a deterministic stub LLM in place of Gemma 4.
// Proves the full pipeline (firewall → fit → trace → vet → cast) runs even
// without Ollama installed. Useful for CI and for demoing the safety
// scaffolding independently of model availability.
//
// Usage: AGENT_MOCK=1 node examples/run-stub.js
import { firewall, policy } from '@mukundakatta/agentguard';
import { run } from '../src/agent.js';

const POLICY = policy({
  network: { allow: ['127.0.0.1', 'localhost', 'en.wikipedia.org'] },
  violations: 'throw',
});

// Scripted "Gemma 4". First turn: pick fetch_url. Second turn: emit final JSON.
// First final response is intentionally malformed so we can see agentcast retry.
let turn = 0;
const stubLlm = async (_messages) => {
  turn++;
  if (turn === 1) {
    return '{"tool":"fetch_url","args":{"url":"https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"}}';
  }
  if (turn === 2) {
    return '{"final": "RLHF is a technique that uses human preferences as a reward signal to fine-tune language models.", "sources": ["https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"]}';
  }
  // agentcast restart-from-history calls — keep returning the well-formed final.
  return '{"final": "RLHF is a technique that uses human preferences as a reward signal to fine-tune language models.", "sources": ["https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"]}';
};

const result = await firewall(POLICY, () => run('What is RLHF?', { llm: stubLlm }));
console.log(JSON.stringify(result, null, 2));
