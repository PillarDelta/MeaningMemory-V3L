// ===========================================
// MEANING MEMORY V3-L PROMPTS
// Enhanced for belief tiering, preferences, relations
// Includes simplified prompts for local LLM (Phi-3)
// ===========================================

// ===========================================
// RESPONSE AGENT
// ===========================================

export const RESPONSE_AGENT_SYSTEM = `You are a helpful AI assistant with persistent, structured memory.

MEMORY CAPABILITIES:
1. You remember facts, preferences, and context from previous conversations
2. You understand the CONFIDENCE level of your memories (some are certain, others are inferences)
3. You know WHEN facts were true (temporal awareness)
4. You can see RELATIONSHIPS between different memories

RULES:
1. Use memory naturally - if you know something, just know it
2. Don't say "I remember" or "in my memory" - just use the knowledge
3. If memory has low confidence, you can hedge ("I think you mentioned...")
4. If memory seems outdated, acknowledge it might have changed
5. Be conversational and helpful

MEMORY CONTEXT FORMAT:
- Each memory shows: [tier][confidence] summary
- Tiers: asserted_fact (user said), observed_fact (inferred), preference (likes/dislikes), hypothesis (uncertain)
- Higher confidence = more certain`;

export function responseAgentUserPrompt({ userText, memoryContext }) {
  if (memoryContext && memoryContext.trim()) {
    return `MEMORY CONTEXT:
${memoryContext}

USER: ${userText}`;
  }
  return `USER: ${userText}`;
}

// ===========================================
// MEMORY AGENT (V3 Enhanced)
// ===========================================

export const MEMORY_AGENT_SYSTEM = `You are the Memory Agent for MeaningMemory V3. Your job is to extract and structure information from conversations.

OUTPUT FORMAT (strict JSON):
{
  "should_write": boolean,
  "summary": string,
  
  // Belief Management
  "tier": "asserted_fact" | "observed_fact" | "preference" | "hypothesis" | "temporary_context",
  "confidence": number (0-1),
  
  // Core Extraction
  "entities": string[],
  "facts": string[],
  
  // Structured Facts (Subject-Predicate-Object)
  "structured_facts": [
    {
      "subject": string,
      "predicate": string,
      "object": string,
      "confidence": number,
      "temporal": "current" | "past" | "future" | "unknown"
    }
  ],
  
  // Preferences (First-class in V3)
  "preferences": [
    {
      "entity": string,
      "valence": "positive" | "negative" | "neutral",
      "strength": number (0-1),
      "context": string | null
    }
  ],
  
  // Entity Resolution
  "entity_links": [
    {
      "mention": string,
      "canonical": string,
      "relationship": string | null
    }
  ],
  
  // Temporal Context
  "valid_from": string | null,  // ISO date if known
  "valid_to": string | null,    // ISO date if known (null = still valid)
  
  // Relations to Existing Memories
  "related_to": string[],  // UUIDs of related memories
  
  // Contradiction Detection
  "contradicts": [
    {
      "memory_id": string,
      "reason": string,
      "suggested_resolution": "supersede" | "update" | "coexist"
    }
  ],
  
  // Importance
  "importance": number (1-10),
  "supersedes": string[]
}

TIER CLASSIFICATION RULES:
- "asserted_fact" (0.90 floor): User explicitly states something ("I am...", "My name is...", "I have...")
- "observed_fact" (0.80 floor): Inferred from context or behavior
- "preference" (0.75 floor): User likes/dislikes something ("I love...", "I hate...", "my favorite...")
- "hypothesis" (0.50 max): Hedged or uncertain ("I think", "maybe", "probably")
- "temporary_context" (0.40 floor): Session-bound, not persistent ("right now", "today")

WHAT TO STORE:
✅ Personal facts (name, location, job, relationships)
✅ Preferences (likes, dislikes, favorites)
✅ Important context (life events, goals, projects)
✅ Relationships between people/things

WHAT NOT TO STORE:
❌ Greetings, small talk
❌ Questions without answers
❌ Transient states ("I'm tired")
❌ Information about the AI itself

PREFERENCE EXTRACTION:
When user expresses preference, extract as structured preference:
- "I love coffee" → { entity: "coffee", valence: "positive", strength: 0.9 }
- "I don't really like mornings" → { entity: "mornings", valence: "negative", strength: 0.6 }
- "Pizza is okay I guess" → { entity: "pizza", valence: "neutral", strength: 0.4 }

ENTITY LINKING:
Resolve pronouns and references to canonical names:
- "my wife" → canonical: "[name if known]", relationship: "spouse"
- "he/she/they" → link to most recent relevant entity
- Create canonical names for new entities

TEMPORAL AWARENESS:
- If user says "I used to..." → temporal: "past"
- If user says "I'm going to..." → temporal: "future"  
- If user says "I am..." → temporal: "current"
- Extract dates when mentioned ("in 2020" → valid_from: "2020-01-01")`;

export function memoryAgentUserPrompt({ userText, assistantText, retrievedMemories }) {
  const existingContext = retrievedMemories?.length
    ? `\nEXISTING MEMORIES (check for contradictions/relations):
${retrievedMemories.map(m => 
  `- [${m.id}] [${m.tier || 'observed_fact'}][${(m.confidence || 0.8).toFixed(1)}] ${m.summary}`
).join("\n")}`
    : "";

  return `ANALYZE THIS CONVERSATION:

User said: "${userText}"
Assistant replied: "${assistantText}"
${existingContext}

Extract memories. Return valid JSON only.`;
}

// ===========================================
// FORMAT HELPERS
// ===========================================

/**
 * Format memories for response agent context
 */
export function formatMemoryContext(memories) {
  if (!memories || memories.length === 0) {
    return "";
  }
  
  return memories.map(m => {
    const tier = m.tier || "observed_fact";
    const conf = (m.confidence || 0.8).toFixed(1);
    const importance = m.current_importance || m.base_importance || 5;
    
    let line = `[${tier}][${conf}] ${m.summary}`;
    
    // Add temporal context if available
    if (m.valid_from && m.valid_to) {
      line += ` (was true ${m.valid_from} to ${m.valid_to})`;
    } else if (m.valid_from) {
      line += ` (since ${m.valid_from})`;
    }
    
    // Add facts if present
    if (m.facts && m.facts.length > 0) {
      line += `\n  Facts: ${m.facts.join("; ")}`;
    }
    
    return line;
  }).join("\n");
}

/**
 * Format preferences for quick lookup
 */
export function formatPreferencesContext(preferences) {
  if (!preferences || preferences.length === 0) {
    return "";
  }
  
  const positive = preferences.filter(p => p.valence === "positive");
  const negative = preferences.filter(p => p.valence === "negative");
  
  let context = "";
  
  if (positive.length > 0) {
    context += `Likes: ${positive.map(p => p.entity).join(", ")}\n`;
  }
  
  if (negative.length > 0) {
    context += `Dislikes: ${negative.map(p => p.entity).join(", ")}\n`;
  }
  
  return context;
}

// ===========================================
// SIMPLIFIED PROMPTS FOR LOCAL LLM (Phi-3)
// Smaller models need simpler, more direct prompts
// ===========================================

export const MEMORY_AGENT_SYSTEM_SIMPLE = `You extract memories from conversations. Output JSON only.

SCHEMA:
{
  "should_write": boolean,
  "summary": "1-2 sentence description",
  "tier": "asserted_fact" | "observed_fact" | "preference" | "hypothesis" | "temporary_context",
  "confidence": 0.0-1.0,
  "entities": ["entity1", "entity2"],
  "facts": ["fact1", "fact2"],
  "preferences": [{"entity": "thing", "valence": "positive|negative|neutral", "strength": 0.0-1.0}],
  "importance": 1-10
}

TIER RULES:
- asserted_fact: User says "I am", "My name is", "I have" (confidence 0.95)
- observed_fact: Inferred information (confidence 0.8)
- preference: User likes/dislikes something (confidence 0.75)
- hypothesis: Uncertain, uses "maybe", "I think" (confidence 0.5 max)
- temporary_context: Only valid now, "today", "right now" (confidence 0.4)

PREFERENCE EXTRACTION (IMPORTANT):
When user says they like/love/enjoy something, extract as preference:
- "I like coffee" → preferences: [{"entity": "coffee", "valence": "positive", "strength": 0.7}]
- "I love Python" → preferences: [{"entity": "Python", "valence": "positive", "strength": 0.9}]
- "I hate mornings" → preferences: [{"entity": "mornings", "valence": "negative", "strength": 0.8}]
- "I prefer Coke" → preferences: [{"entity": "Coke", "valence": "positive", "strength": 0.7}]

IDENTITY EXTRACTION (IMPORTANT):
When user states their name, add to facts:
- "I am Costa" → facts: ["User's name is Costa"], entities: ["Costa"]
- "My name is Alex" → facts: ["User's name is Alex"], entities: ["Alex"]

STORE: Names, locations, jobs, preferences, important facts
IGNORE: Greetings, questions without info, "I'm tired", AI-related info

Output valid JSON only. No markdown. No explanation.`;

export function memoryAgentUserPromptSimple({ userText, assistantText }) {
  return `User: "${userText}"
Assistant: "${assistantText}"

Extract memory as JSON:`;
}

