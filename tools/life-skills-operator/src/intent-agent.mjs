import { Agent, run } from '@openai/agents';
import { IntentSchema } from './contracts.mjs';

const instructions = `
You are the Life Skills owner-intent resolver.
The owner often thinks aloud, corrects himself, compares images, and issues short commands.
Convert the latest natural-language input into structured intent without making the owner restate it.

Classify the turn as exactly one of:
- execute_approved_intent: execution of already-settled intent
- owner_correction: explicit owner correction to current execution/brand intent
- proposed_decision: genuinely new policy or unresolved choice

For creative work, distinguish website_hero from ad_creative.
A website hero uses a static art plate plus LIVE HTML toolbar/copy/WhatsApp button/benefits.
An ad is a raster creative; the on-image WhatsApp CTA is visual, while Meta owns the actual clickable CTA.
Never infer a new photo master, OpenArt project, or reference ID from prose. Those are resolved deterministically after this step.
Return only the schema output.
`.trim();

export async function resolveIntent(rawText) {
  const agent = new Agent({
    name: 'Life Skills Intent Resolver',
    model: process.env.OPENAI_MODEL || 'gpt-5.6',
    instructions,
    outputType: IntentSchema,
  });
  const result = await run(agent, rawText);
  if (!result.finalOutput) throw new Error('Intent resolver produced no output');
  return result.finalOutput;
}
