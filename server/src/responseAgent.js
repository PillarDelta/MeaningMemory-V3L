// MeaningMemory V3 - Response Agent
// Generates contextually-aware responses using memory

import { grok, INTERACTION_MODEL } from "./llm.js";
import { RESPONSE_AGENT_SYSTEM, responseAgentUserPrompt, formatMemoryContext, formatPreferencesContext } from "./prompts.js";

/**
 * Run response agent (non-streaming)
 */
export async function runResponseAgent({ userText, retrievedMemories, preferences = [] }) {
  // Format memory context with tier and confidence info
  const memoryContext = formatMemoryContext(retrievedMemories);
  const prefContext = formatPreferencesContext(preferences);
  
  const fullContext = [memoryContext, prefContext].filter(Boolean).join("\n\n");
  
  console.log(`[Response Agent] Memory context: ${fullContext ? fullContext.substring(0, 200) + "..." : "(none)"}`);
  console.log(`[Response Agent] Sending to ${INTERACTION_MODEL}...`);

  const resp = await grok.chat.completions.create({
    model: INTERACTION_MODEL,
    messages: [
      { role: "system", content: RESPONSE_AGENT_SYSTEM },
      { role: "user", content: responseAgentUserPrompt({ userText, memoryContext: fullContext }) }
    ]
  });

  console.log("[Response Agent] Response received");
  return resp.choices[0].message.content;
}

/**
 * Run response agent with STREAMING
 * Returns an async iterator of text chunks
 */
export async function runResponseAgentStreaming({ userText, retrievedMemories, preferences = [] }) {
  // Format memory context with tier and confidence info
  const memoryContext = formatMemoryContext(retrievedMemories);
  const prefContext = formatPreferencesContext(preferences);
  
  const fullContext = [memoryContext, prefContext].filter(Boolean).join("\n\n");
  
  console.log(`[Response Agent] Memory context: ${fullContext ? fullContext.substring(0, 200) + "..." : "(none)"}`);
  console.log(`[Response Agent] Starting stream from ${INTERACTION_MODEL}...`);

  const stream = await grok.chat.completions.create({
    model: INTERACTION_MODEL,
    messages: [
      { role: "system", content: RESPONSE_AGENT_SYSTEM },
      { role: "user", content: responseAgentUserPrompt({ userText, memoryContext: fullContext }) }
    ],
    stream: true
  });

  return stream;
}

