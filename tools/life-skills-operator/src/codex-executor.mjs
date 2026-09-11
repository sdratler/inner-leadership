import { Agent, run } from '@openai/agents';
import { codexTool } from '@openai/agents-extensions/experimental/codex';

export async function executeWithCodex(contract) {
  const workingDirectory = process.env.LIFE_SKILLS_REPO;
  if (!workingDirectory) throw new Error('LIFE_SKILLS_REPO is required for execute mode');

  const context = {};
  const agent = new Agent({
    name: 'Life Skills Contract Executor',
    model: process.env.OPENAI_MODEL || 'gpt-5.6',
    instructions: `
You execute a machine-validated Life Skills execution contract.
Do not reinterpret asset IDs, provider project IDs, layering boundaries or effect permissions.
Use the Codex tool for workspace/MCP operations.
If Codex cannot retrieve an exact asset or provider receipt, stop and report the exact blocker.
Never substitute an asset by visual similarity or filename guess.
Never promote an unapproved proof to a master.
Never publish, spend, deploy, merge or mutate provider configuration when the contract effects say false.
`.trim(),
    tools: [
      codexTool({
        name: 'engineer',
        useRunContextThreadId: true,
        sandboxMode: 'workspace-write',
        workingDirectory,
        defaultThreadOptions: {
          model: process.env.CODEX_MODEL || 'gpt-5.6',
          networkAccessEnabled: true,
          webSearchEnabled: false,
          approvalPolicy: 'never',
        },
      }),
    ],
  });

  const prompt = `Execute only this contract. First print an execution preflight receipt, then perform allowed effects, then print a closeout receipt.\n\n${JSON.stringify(contract, null, 2)}`;
  const result = await run(agent, prompt, { context });
  return result.finalOutput;
}
