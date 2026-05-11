// One-shot demo: wraps the agent run in an agentguard firewall so any stray
// fetch outside the allowlist throws PolicyViolation before it hits the network.
//
// Usage:
//   node examples/run-demo.js "What is RLHF?"
//   AGENT_MOCK=1 node examples/run-demo.js "What is RLHF?"
import { firewall, policy } from '@mukundakatta/agentguard';
import { run } from '../src/agent.js';

const RESEARCH_POLICY = policy({
  network: {
    allow: [
      '127.0.0.1', // ollama
      'localhost',
      'en.wikipedia.org',
      'arxiv.org',
    ],
    deny: ['169.254.169.254'], // cloud metadata SSRF
  },
  budget: { maxRequests: 30 },
  violations: 'throw',
});

const question = process.argv.slice(2).join(' ').trim() || 'What is RLHF?';

const result = await firewall(RESEARCH_POLICY, () => run(question));

console.log(JSON.stringify(result, null, 2));
