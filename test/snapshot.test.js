// Snapshot test: agentsnap records the tool-call trace from a deterministic
// mocked run. First invocation writes the baseline; subsequent runs fail CI
// if Gemma 4 starts picking different tools or different args.
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

test('research agent stays on rails', async () => {
  if (process.env.AGENT_MOCK !== '1') {
    // The snapshot is only deterministic against mock pages.
    return;
  }
  const trace = await record(
    () => firewall(POLICY, () => run('What is RLHF?')),
    { input: 'What is RLHF?', model: process.env.GEMMA_MODEL ?? 'gemma4:2b' },
  );
  await expectSnapshot(trace, 'test/__snapshots__/rlhf.snap.json');
});
