// Snapshot test: agentsnap records the tool-call trace from a deterministic
// run. First invocation writes the baseline; subsequent runs fail CI if the
// agent starts picking different tools or different args.
//
// The run uses a scripted stub LLM (identical script to examples/run-stub.js)
// instead of the live Ollama model so the trace is fully deterministic and the
// test passes in CI without Ollama installed. AGENT_MOCK=1 additionally feeds
// canned pages to fetch_url so no network egress happens.
//
// Run:
//   AGENT_MOCK=1 node --test 'test/**/*.test.js'
// Update baseline (after eyeballing the diff):
//   AGENT_MOCK=1 AGENTSNAP_UPDATE=1 node --test 'test/**/*.test.js'
import { test } from 'node:test';
import { record, expectSnapshot } from '@mukundakatta/agentsnap';
import { firewall, policy } from '@mukundakatta/agentguard';
import { run } from '../src/agent.js';

const POLICY = policy({
  network: { allow: ['127.0.0.1', 'localhost', 'en.wikipedia.org'] },
  violations: 'throw',
});

// Scripted "Gemma 4": turn 1 picks fetch_url, turn 2+ emits the final JSON.
// Keeps the snapshot deterministic regardless of model availability.
function makeStubLlm() {
  let turn = 0;
  return async () => {
    turn++;
    if (turn === 1) {
      return '{"tool":"fetch_url","args":{"url":"https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"}}';
    }
    return '{"final": "RLHF is a technique that uses human preferences as a reward signal to fine-tune language models.", "sources": ["https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback"]}';
  };
}

test('research agent stays on rails', async () => {
  if (process.env.AGENT_MOCK !== '1') {
    // The snapshot is only deterministic against mock pages.
    return;
  }
  const trace = await record(
    () => firewall(POLICY, () => run('What is RLHF?', { llm: makeStubLlm() })),
    { input: 'What is RLHF?', model: 'stub' },
  );
  await expectSnapshot(trace, 'test/__snapshots__/rlhf.snap.json');
});
