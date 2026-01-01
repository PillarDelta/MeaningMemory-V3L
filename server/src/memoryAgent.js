// MeaningMemory V3-L - Memory Agent
// Uses LOCAL LLM (Phi-3 via Ollama) for memory extraction
// Falls back to Grok if Ollama unavailable

import { z } from "zod";
import { ollama, grok, LOCAL_MEMORY_MODEL, CLOUD_MEMORY_MODEL, isOllamaAvailable } from "./llm.js";
import { config } from "./config.js";
import { MEMORY_AGENT_SYSTEM, MEMORY_AGENT_SYSTEM_SIMPLE, memoryAgentUserPrompt, memoryAgentUserPromptSimple } from "./prompts.js";
import { classifyTier, enforceConfidenceBounds } from "./beliefTiering.js";

// ===========================================
// V3 MEMORY SCHEMA
// ===========================================

const StructuredFactSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  temporal: z.enum(["current", "past", "future", "unknown"]).optional().default("current")
});

const PreferenceSchema = z.object({
  entity: z.string(),
  valence: z.enum(["positive", "negative", "neutral"]),
  strength: z.number().min(0).max(1).optional().default(0.5),
  context: z.string().nullable().optional()
});

const EntityLinkSchema = z.object({
  mention: z.string(),
  canonical: z.string(),
  relationship: z.string().nullable().optional()
});

const ContradictionSchema = z.object({
  memory_id: z.string(),
  reason: z.string(),
  suggested_resolution: z.enum(["supersede", "update", "coexist"]).optional().default("supersede")
});

const MemoryAgentSchema = z.object({
  should_write: z.boolean(),
  summary: z.string().optional().default(""),
  
  // V3: Belief Management
  tier: z.enum([
    "asserted_fact",
    "observed_fact", 
    "preference",
    "hypothesis",
    "temporary_context"
  ]).optional().default("observed_fact"),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  
  // Core Extraction
  entities: z.array(z.string()).optional().default([]),
  facts: z.array(z.string()).optional().default([]),
  structured_facts: z.array(StructuredFactSchema).optional().default([]),
  
  // V3: First-class Preferences
  preferences: z.array(PreferenceSchema).optional().default([]),
  
  // Entity Resolution
  entity_links: z.array(EntityLinkSchema).optional().default([]),
  
  // V3: Temporal Context
  valid_from: z.string().nullable().optional(),
  valid_to: z.string().nullable().optional(),
  
  // V3: Relations
  related_to: z.array(z.string()).optional().default([]),
  
  // Contradiction Handling
  contradicts: z.array(ContradictionSchema).optional().default([]),
  
  // Importance & Supersession
  importance: z.number().min(1).max(10).optional().default(5),
  supersedes: z.array(z.string()).optional().default([])
});

// Simplified preference schema for local LLM
const SimplePreferenceSchema = z.object({
  entity: z.string(),
  valence: z.enum(["positive", "negative", "neutral"]),
  strength: z.number().min(0).max(1).optional().default(0.5)
});

// Simplified schema for local LLM (more reliable)
const SimpleMemorySchema = z.object({
  should_write: z.boolean(),
  summary: z.string().optional().default(""),
  tier: z.enum([
    "asserted_fact",
    "observed_fact", 
    "preference",
    "hypothesis",
    "temporary_context"
  ]).optional().default("observed_fact"),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  entities: z.array(z.string()).optional().default([]),
  facts: z.array(z.string()).optional().default([]),
  preferences: z.array(SimplePreferenceSchema).optional().default([]),
  importance: z.number().min(1).max(10).optional().default(5)
});

// ===========================================
// PARSING
// ===========================================

/**
 * Sanitize LLM response to fix common issues before schema validation
 */
function sanitizeLLMResponse(json) {
  // Fix null importance
  if (json.importance === null || json.importance === undefined) {
    json.importance = 5;
  }
  
  // Fix confidence
  if (json.confidence === null || json.confidence === undefined) {
    json.confidence = 0.8;
  }
  
  // Fix facts array - ensure all items are strings
  if (Array.isArray(json.facts)) {
    json.facts = json.facts.map(fact => {
      if (typeof fact === 'object' && fact !== null) {
        // Convert object to string representation
        return fact.fact || fact.text || fact.content || JSON.stringify(fact);
      }
      return String(fact || '');
    }).filter(f => f.length > 0);
  }
  
  // Fix entities array - ensure all items are strings
  if (Array.isArray(json.entities)) {
    json.entities = json.entities.map(entity => {
      if (typeof entity === 'object' && entity !== null) {
        return entity.name || entity.entity || JSON.stringify(entity);
      }
      return String(entity || '');
    }).filter(e => e.length > 0);
  }
  
  // Ensure summary is a string
  if (typeof json.summary !== 'string') {
    json.summary = String(json.summary || '');
  }
  
  // Ensure should_write is a boolean
  if (typeof json.should_write !== 'boolean') {
    json.should_write = Boolean(json.summary && json.summary.length > 0);
  }
  
  // Sanitize preferences array
  if (Array.isArray(json.preferences)) {
    json.preferences = json.preferences
      .filter(p => p && typeof p === 'object' && p.entity)
      .map(p => ({
        entity: String(p.entity || ''),
        valence: ['positive', 'negative', 'neutral'].includes(p.valence) ? p.valence : 'neutral',
        strength: typeof p.strength === 'number' ? Math.min(1, Math.max(0, p.strength)) : 0.5
      }));
  } else {
    json.preferences = [];
  }
  
  return json;
}

function parseMemoryAgentResponse(content, useSimpleSchema = false) {
  try {
    // Clean up response - remove markdown code blocks if present
    let cleaned = content.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();
    
    let json = JSON.parse(cleaned);
    
    // Sanitize the JSON to fix common LLM issues
    json = sanitizeLLMResponse(json);
    
    const schema = useSimpleSchema ? SimpleMemorySchema : MemoryAgentSchema;
    const parsed = schema.safeParse(json);
    
    if (parsed.success) {
      const data = parsed.data;
      data.confidence = enforceConfidenceBounds(data.tier, data.confidence);
      return { ok: true, data };
    }
    
    console.log("[Memory Agent] Schema validation failed:", parsed.error.issues);
    return { ok: false, error: parsed.error };
  } catch (e) {
    console.log("[Memory Agent] JSON parse failed:", e.message);
    console.log("[Memory Agent] Raw content:", content.substring(0, 200));
    return { ok: false, error: e };
  }
}

// ===========================================
// LOCAL LLM (Ollama/Phi-3)
// ===========================================

async function runLocalMemoryAgent(payload) {
  console.log(`[Memory Agent] 💻 Using LOCAL LLM (${LOCAL_MEMORY_MODEL})...`);
  
  const messages = [
    { role: "system", content: MEMORY_AGENT_SYSTEM_SIMPLE },
    { role: "user", content: memoryAgentUserPromptSimple(payload) }
  ];

  try {
    const resp = await ollama.chat.completions.create({
      model: LOCAL_MEMORY_MODEL,
      messages,
      temperature: 0.1, // Low temperature for consistent JSON
      response_format: { type: "json_object" }
    });
    
    const content = resp.choices[0]?.message?.content ?? "";
    
    const first = parseMemoryAgentResponse(content, true);
    if (first.ok) {
      logExtraction(first.data, "LOCAL");
      return first.data;
    }

    // Retry with even simpler prompt
    console.log("[Memory Agent] Retrying with simpler prompt...");
    
    const retry = await ollama.chat.completions.create({
      model: LOCAL_MEMORY_MODEL,
      messages: [
        ...messages,
        { role: "user", content: "Output ONLY valid JSON. No explanation." }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const retryContent = retry.choices[0]?.message?.content ?? "";
    const second = parseMemoryAgentResponse(retryContent, true);
    
    if (second.ok) {
      logExtraction(second.data, "LOCAL");
      return second.data;
    }

    throw new Error("Local LLM returned invalid JSON");
    
  } catch (err) {
    console.error("[Memory Agent] Local LLM error:", err.message);
    throw err;
  }
}

// ===========================================
// CLOUD LLM (Grok) - Fallback
// ===========================================

async function runCloudMemoryAgent(payload) {
  console.log(`[Memory Agent] 🌐 Using CLOUD LLM (${CLOUD_MEMORY_MODEL})...`);
  
  const messages = [
    { role: "system", content: MEMORY_AGENT_SYSTEM },
    { role: "user", content: memoryAgentUserPrompt(payload) }
  ];

  const resp = await grok.chat.completions.create({
    model: CLOUD_MEMORY_MODEL,
    messages,
    response_format: { type: "json_object" }
  });
  
  const content = resp.choices[0]?.message?.content ?? "";
  
  const first = parseMemoryAgentResponse(content);
  if (first.ok) {
    logExtraction(first.data, "CLOUD");
    return first.data;
  }

  // Retry once if parsing failed
  console.log("[Memory Agent] Retrying with stricter prompt...");
  
  const retry = await grok.chat.completions.create({
    model: CLOUD_MEMORY_MODEL,
    messages: [
      ...messages,
      { role: "user", content: "Return only valid JSON matching the exact schema. No extra text or markdown." }
    ],
    response_format: { type: "json_object" }
  });

  const retryContent = retry.choices[0]?.message?.content ?? "";
  const second = parseMemoryAgentResponse(retryContent);
  
  if (second.ok) {
    logExtraction(second.data, "CLOUD");
    return second.data;
  }

  throw new Error("Memory Agent returned invalid JSON after retry");
}

// ===========================================
// MAIN FUNCTION (with fallback)
// ===========================================

export async function runMemoryAgent(payload) {
  console.log(`[Memory Agent] Analyzing conversation...`);
  
  // Try local LLM first if configured and available
  if (config.USE_LOCAL_MEMORY_LLM && isOllamaAvailable()) {
    try {
      return await runLocalMemoryAgent(payload);
    } catch (err) {
      console.log("[Memory Agent] ⚠️ Local LLM failed, falling back to Cloud...");
    }
  }
  
  // Fallback to cloud LLM
  return await runCloudMemoryAgent(payload);
}

// ===========================================
// LOGGING
// ===========================================

function logExtraction(data, source = "") {
  const prefix = source ? `[Memory Agent ${source}]` : "[Memory Agent]";
  
  if (!data.should_write) {
    console.log(`${prefix} Nothing to store`);
    return;
  }
  
  console.log(`${prefix} Extracted:`);
  console.log(`  Summary: ${data.summary}`);
  console.log(`  Tier: ${data.tier} (confidence: ${data.confidence})`);
  console.log(`  Importance: ${data.importance}`);
  
  if (data.entities?.length > 0) {
    console.log(`  Entities: ${data.entities.join(", ")}`);
  }
  
  if (data.preferences?.length > 0) {
    console.log(`  Preferences: ${data.preferences.map(p => 
      `${p.valence === "positive" ? "+" : p.valence === "negative" ? "-" : "~"}${p.entity}`
    ).join(", ")}`);
  }
  
  if (data.structured_facts?.length > 0) {
    console.log(`  Structured Facts: ${data.structured_facts.length}`);
  }
  
  if (data.contradicts?.length > 0) {
    console.log(`  ⚠️ Contradictions detected: ${data.contradicts.length}`);
  }
}
