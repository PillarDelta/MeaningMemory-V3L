// ===========================================
// MEANING MEMORY V3-L - Main Server
// Local Memory LLM (Phi-3) + Cloud Interaction (Grok)
// ===========================================

import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Core modules
import { initEmbedder } from "./embeddings.js";
import { retrieveMemories, insertMemoryUnit, getUserPreferences, getMemoryStats, getAllMemories, getAllEntities } from "./memoryStore.js";
import { runMemoryAgent } from "./memoryAgent.js";
import { runResponseAgentStreaming } from "./responseAgent.js";

// V3 Intelligence modules
import { startDecayService, runDecayUpdate } from "./decayService.js";
import { getPendingContradictions, resolveContradiction } from "./contradictionDetector.js";
import { getMemoriesForEntity, confirmEntity } from "./entityResolver.js";
import { getMemoryRelations } from "./graphRetrieval.js";

// V3-L: Local LLM support
import { checkOllamaHealth, isOllamaAvailable } from "./llm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientPath = resolve(__dirname, "../../client");

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files
app.use(express.static(clientPath));

app.get("/", (req, res) => {
  res.sendFile(resolve(clientPath, "index.html"));
});

// ===========================================
// MAIN CHAT ENDPOINT (Streaming)
// ===========================================

app.post("/chat", async (req, res) => {
  try {
    const userText = req.body?.message;
    const conversationId = req.body?.conversation_id;
    
    if (!userText || typeof userText !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'message' field" });
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log(`[Chat] User: ${userText}`);

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Phase 0: INSTANT PATTERN EXTRACTION (no LLM, immediate)
    // This stores critical info BEFORE we even respond
    const instantResult = await extractAndStoreInstant(userText);
    if (instantResult.stored) {
      console.log(`[Phase 0] ⚡ Instant stored: "${instantResult.summary}"`);
    }

    // Phase 1: RETRIEVAL (Enhanced with spreading activation)
    console.log("\n[Phase 1] Retrieving memories...");
    const memories = await retrieveMemories({ queryText: userText });
    console.log(`[Phase 1] Found ${memories.length} memories`);
    
    // Also get user preferences for context
    const preferences = await getUserPreferences({});
    console.log(`[Phase 1] Found ${preferences.length} preferences`);

    // Phase 2: RESPONSE GENERATION (Streaming)
    console.log("\n[Phase 2] Generating response...");
    const stream = await runResponseAgentStreaming({ 
      userText, 
      retrievedMemories: memories,
      preferences 
    });
    
    let fullReply = "";
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullReply += content;
        res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
      }
    }

    console.log("[Phase 2] Stream complete");

    // Signal stream complete and END IMMEDIATELY
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // Phase 3 & 4: MEMORY EXTRACTION + STORAGE (True Background - fire and forget)
    // This runs after response is sent, user doesn't wait
    processMemoryAsync(userText, fullReply, memories, conversationId)
      .then(result => {
        if (result.stored) {
          console.log(`[Background] Memory stored: "${result.summary}"`);
        }
      })
      .catch(err => {
        console.error("[Background Memory] Error:", err.message);
      });

  } catch (err) {
    console.error("[Chat] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ===========================================
// INSTANT PATTERN EXTRACTION (No LLM - Immediate)
// ===========================================

// Patterns for instant extraction
const NAME_PATTERNS = [
  /(?:my name is|i am|i'm|call me)\s+([A-Z][a-z]+)/i,
  /(?:this is)\s+([A-Z][a-z]+)\s+(?:speaking|here)/i
];

const PREFERENCE_PATTERNS = [
  { pattern: /i (?:love|really love|adore)\s+(.+?)(?:\.|,|!|$)/i, valence: "positive", strength: 0.9 },
  { pattern: /i (?:like|enjoy|prefer)\s+(.+?)(?:\.|,|!|$)/i, valence: "positive", strength: 0.7 },
  { pattern: /i (?:hate|really hate|despise|can't stand)\s+(.+?)(?:\.|,|!|$)/i, valence: "negative", strength: 0.9 },
  { pattern: /i (?:don't like|dislike)\s+(.+?)(?:\.|,|!|$)/i, valence: "negative", strength: 0.7 },
  { pattern: /my favorite (?:is|are)\s+(.+?)(?:\.|,|!|$)/i, valence: "positive", strength: 0.85 }
];

async function extractAndStoreInstant(userText) {
  const results = { stored: false, summary: "", type: null };
  
  try {
    // Check for name
    for (const pattern of NAME_PATTERNS) {
      const match = userText.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Skip common non-names
        if (['here', 'there', 'fine', 'good', 'great', 'okay'].includes(name.toLowerCase())) continue;
        
        const mem = {
          summary: `User's name is ${name}.`,
          tier: "asserted_fact",
          confidence: 0.95,
          entities: [name],
          facts: [`User's name is ${name}`],
          importance: 8,
          preferences: []
        };
        
        await insertMemoryUnit(mem);
        results.stored = true;
        results.summary = mem.summary;
        results.type = "name";
        console.log(`[Instant] ⚡ Name extracted: ${name}`);
        break;
      }
    }
    
    // Check for preferences
    for (const { pattern, valence, strength } of PREFERENCE_PATTERNS) {
      const match = userText.match(pattern);
      if (match && match[1]) {
        const entity = match[1].trim().replace(/\s+and\s+.*/, ''); // Take first item if "X and Y"
        if (entity.length < 2 || entity.length > 50) continue;
        
        const mem = {
          summary: `User ${valence === 'positive' ? 'likes' : 'dislikes'} ${entity}.`,
          tier: "preference",
          confidence: 0.85,
          entities: [entity],
          facts: [`User ${valence === 'positive' ? 'likes' : 'dislikes'} ${entity}`],
          importance: 6,
          preferences: [{ entity, valence, strength }]
        };
        
        await insertMemoryUnit(mem);
        results.stored = true;
        results.summary = mem.summary;
        results.type = "preference";
        console.log(`[Instant] ⚡ Preference extracted: ${valence} ${entity}`);
        
        // Check for "and" to extract multiple preferences
        const andMatch = userText.match(new RegExp(pattern.source.replace('(.+?)', '.+?\\s+and\\s+(.+?)'), 'i'));
        if (andMatch && andMatch[1]) {
          const entity2 = andMatch[1].trim();
          // Detect if second item has opposite valence (e.g., "love X and hate Y")
          const hateMatch = userText.match(/(?:hate|dislike|don't like)\s+(.+?)(?:\.|,|!|$)/i);
          if (hateMatch) {
            const hatedEntity = hateMatch[1].trim();
            const mem2 = {
              summary: `User dislikes ${hatedEntity}.`,
              tier: "preference",
              confidence: 0.85,
              entities: [hatedEntity],
              facts: [`User dislikes ${hatedEntity}`],
              importance: 6,
              preferences: [{ entity: hatedEntity, valence: "negative", strength: 0.8 }]
            };
            await insertMemoryUnit(mem2);
            console.log(`[Instant] ⚡ Preference extracted: negative ${hatedEntity}`);
          }
        }
        break;
      }
    }
    
  } catch (err) {
    console.error("[Instant] Error:", err.message);
  }
  
  return results;
}

// ===========================================
// BACKGROUND MEMORY PROCESSING (LLM-based)
// ===========================================

async function processMemoryAsync(userText, assistantText, retrievedMemories, conversationId) {
  console.log("\n[Phase 3] Extracting memories...");
  
  // Phase 3: MEMORY EXTRACTION
  const mem = await runMemoryAgent({ 
    userText, 
    assistantText, 
    retrievedMemories 
  });
  
  if (!mem.should_write) {
    console.log("[Phase 3] Nothing to store");
    return { stored: false };
  }

  // Phase 4: STORAGE with all V3 enhancements
  console.log("\n[Phase 4] Storing memory...");
  
  // Add conversation ID for provenance
  mem.source_conversation_id = conversationId;
  
  const stored = await insertMemoryUnit(mem);
  
  console.log(`[Phase 4] Stored: "${stored.summary}"`);
  console.log(`  Tier: ${stored.tier}, Confidence: ${stored.confidence}`);
  console.log(`  Conflicts detected: ${stored.conflicts_detected}`);
  console.log(`  Auto-resolved: ${stored.auto_resolved}`);
  console.log(`  Preferences stored: ${stored.preferences_stored}`);
  
  return { 
    stored: true, 
    summary: stored.summary,
    id: stored.id,
    tier: stored.tier,
    confidence: stored.confidence,
    conflicts_detected: stored.conflicts_detected
  };
}

// ===========================================
// V3 API ENDPOINTS
// ===========================================

// Get all memories
app.get("/memories", async (req, res) => {
  try {
    const includeInactive = req.query.inactive === "true";
    const memories = await getAllMemories({ includeInactive });
    res.json(memories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get memory statistics
app.get("/stats", async (req, res) => {
  try {
    const stats = await getMemoryStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all entities
app.get("/entities", async (req, res) => {
  try {
    const entities = await getAllEntities();
    res.json(entities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get memories for an entity
app.get("/entities/:id/memories", async (req, res) => {
  try {
    const result = await getMemoriesForEntity(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm an entity
app.post("/entities/:id/confirm", async (req, res) => {
  try {
    await confirmEntity(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user preferences
app.get("/preferences", async (req, res) => {
  try {
    const preferences = await getUserPreferences({
      entity: req.query.entity,
      valence: req.query.valence
    });
    res.json(preferences);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get memory relations
app.get("/memories/:id/relations", async (req, res) => {
  try {
    const relations = await getMemoryRelations(req.params.id);
    res.json(relations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending contradictions
app.get("/contradictions", async (req, res) => {
  try {
    const contradictions = await getPendingContradictions();
    res.json(contradictions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve a contradiction
app.post("/contradictions/:id/resolve", async (req, res) => {
  try {
    const { resolution, note } = req.body;
    await resolveContradiction(req.params.id, resolution, note);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger decay update manually
app.post("/decay/run", async (req, res) => {
  try {
    const result = await runDecayUpdate();
    res.json({ updated: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// STARTUP
// ===========================================

async function start() {
  console.log("\n" + "=".repeat(55));
  console.log("🧠 MeaningMemory V3-L Starting...");
  console.log("   (Local Memory LLM + Cloud Interaction)");
  console.log("=".repeat(55) + "\n");
  
  console.log("[Config]");
  console.log(`  Port: ${config.PORT}`);
  console.log(`  Database: ${config.DATABASE_URL.split("@")[1] || config.DATABASE_URL}`);
  console.log(`  Embedding Model: ${config.EMBED_MODEL}`);
  console.log(`  Decay Rate: ${config.DECAY_RATE}/day`);
  
  console.log("\n[LLM Configuration]");
  console.log(`  Memory LLM: LOCAL (Ollama/${config.OLLAMA_MEMORY_MODEL})`);
  console.log(`  Interaction LLM: CLOUD (Grok/${config.XAI_INTERACTION_MODEL})`);
  console.log(`  Fallback: ${config.XAI_MEMORY_MODEL}`);
  
  // Check Ollama availability
  console.log("\n[Startup] Checking Ollama...");
  const ollamaOk = await checkOllamaHealth();
  
  if (!ollamaOk) {
    console.log("⚠️  Ollama not available - will use Cloud fallback for memory");
    console.log("   To enable local LLM:");
    console.log("   1. brew services start ollama");
    console.log("   2. ollama pull phi3:mini");
  }
  
  // Pre-load embedding model
  console.log("\n[Startup] Loading embedding model...");
  await initEmbedder();
  
  // Start decay service
  startDecayService();
  
  app.listen(config.PORT, () => {
    console.log("\n" + "=".repeat(55));
    console.log(`🧠 MeaningMemory V3-L running on http://localhost:${config.PORT}`);
    console.log("=".repeat(55));
    console.log("\nV3-L Features:");
    console.log(`  ${ollamaOk ? "✅" : "⚠️"} Local Memory LLM (Phi-3 via Ollama)`);
    console.log("  ✅ Cloud Interaction LLM (Grok)");
    console.log("  ✅ Belief Tiering (5 tiers)");
    console.log("  ✅ Memory Decay (exponential + reinforcement)");
    console.log("  ✅ Contradiction Detection");
    console.log("  ✅ Entity Resolution");
    console.log("  ✅ Graph Relations (spreading activation)");
    console.log("  ✅ First-class Preferences");
    console.log("\n📱 Open http://localhost:" + config.PORT + " in your browser\n");
  });
}

start().catch(err => {
  console.error("Failed to start:", err);
  process.exit(1);
});

