import { Agent } from '@mastra/core/agent'

export const supportAgent = new Agent({
  id: 'support-agent',
  name: 'Support Agent',
  instructions: `You are a support assistant for a UK trade business.
Answer clearly and concisely. If you do not know something, say so.`,
  // Model router format: "provider/model". Requires the matching provider key
  // (e.g. OPENAI_API_KEY) to be set as an environment variable.
  model: 'openai/gpt-4o-mini',
})
