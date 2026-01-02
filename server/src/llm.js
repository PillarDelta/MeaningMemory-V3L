// MeaningMemory V3-L-Core1 - LLM Clients
// Local: Ollama/MeaningMemoryCore1 for Memory Agent
// Cloud: Grok for Interaction Agent

// Load environment variables before anything else
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import { config } from "./config.js";

// ===========================================
// CLOUD LLM: xAI/Grok (for Interaction)
// ===========================================

if (!config.XAI_API_KEY) {
  console.error("⚠️  XAI_API_KEY not set - Interaction Agent will fail");
}

export const grok = new OpenAI({
  apiKey: config.XAI_API_KEY,
  baseURL: config.XAI_BASE_URL
});

export const INTERACTION_MODEL = config.XAI_INTERACTION_MODEL;

// ===========================================
// LOCAL LLM: Ollama/Phi-3 (for Memory)
// ===========================================

export const ollama = new OpenAI({
  baseURL: `${config.OLLAMA_BASE_URL}/v1`,
  apiKey: "ollama" // Ollama doesn't require an API key
});

export const LOCAL_MEMORY_MODEL = config.OLLAMA_MEMORY_MODEL;
export const CLOUD_MEMORY_MODEL = config.XAI_MEMORY_MODEL;

// ===========================================
// HEALTH CHECK: Is Ollama running?
// ===========================================

let ollamaAvailable = null;

export async function checkOllamaHealth() {
  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(3000)
    });
    
    if (response.ok) {
      const data = await response.json();
      const hasModel = data.models?.some(m => 
        m.name.includes("phi3") || m.name.includes(config.OLLAMA_MEMORY_MODEL.split(":")[0])
      );
      
      if (hasModel) {
        console.log(`[LLM] ✅ Ollama available with ${config.OLLAMA_MEMORY_MODEL}`);
        ollamaAvailable = true;
        return true;
      } else {
        console.log(`[LLM] ⚠️  Ollama running but ${config.OLLAMA_MEMORY_MODEL} not found`);
        console.log(`[LLM]    Available models:`, data.models?.map(m => m.name).join(", ") || "none");
        ollamaAvailable = false;
        return false;
      }
    }
    ollamaAvailable = false;
    return false;
  } catch (err) {
    console.log(`[LLM] ⚠️  Ollama not available: ${err.message}`);
    ollamaAvailable = false;
    return false;
  }
}

export function isOllamaAvailable() {
  return ollamaAvailable === true;
}

// ===========================================
// LOGGING
// ===========================================

console.log(`[LLM] V3-L Configuration:`);
console.log(`  Memory LLM: ${config.USE_LOCAL_MEMORY_LLM ? "LOCAL (Ollama/" + LOCAL_MEMORY_MODEL + ")" : "CLOUD (Grok)"}`);
console.log(`  Interaction LLM: CLOUD (Grok/${INTERACTION_MODEL})`);
console.log(`  Ollama URL: ${config.OLLAMA_BASE_URL}`);
