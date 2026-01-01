// MeaningMemory V3 - Memory Store
// Enhanced storage with belief tiering, preferences, and graph relations

import pg from "pg";
import { config } from "./config.js";
import { embedText } from "./embeddings.js";
import { retrieveWithSpreadingActivation, createRelation, discoverRelations } from "./graphRetrieval.js";
import { resolveEntities, linkMemoryToEntities } from "./entityResolver.js";
import { detectContradictions, recordContradiction } from "./contradictionDetector.js";
import { reinforceMemories } from "./decayService.js";

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// ===========================================
// RETRIEVAL (Enhanced with spreading activation)
// ===========================================

/**
 * Retrieve memories using V3 enhanced retrieval
 * - Vector similarity
 * - Keyword matching  
 * - Decay-weighted scoring
 * - Spreading activation through graph
 */
export async function retrieveMemories({ queryText, k = config.RETRIEVAL_K }) {
  const memories = await retrieveWithSpreadingActivation({ queryText, k });
  
  // Reinforce retrieved memories (updates access tracking)
  if (memories.length > 0) {
    const ids = memories.map(m => m.id);
    await reinforceMemories(ids);
  }
  
  return memories;
}

/**
 * Get user preferences (for quick context)
 */
export async function getUserPreferences({ entity = null, valence = null }) {
  let query = `
    SELECT * FROM preferences
    WHERE is_active = true
  `;
  const params = [];
  
  if (entity) {
    params.push(entity);
    query += ` AND LOWER(entity) LIKE LOWER($${params.length})`;
  }
  
  if (valence) {
    params.push(valence);
    query += ` AND valence = $${params.length}`;
  }
  
  query += ` ORDER BY created_at DESC`;
  
  const result = await pool.query(query, params);
  return result.rows;
}

// ===========================================
// INSERTION (Enhanced with V3 features)
// ===========================================

/**
 * Insert a new memory unit with V3 enhancements
 */
export async function insertMemoryUnit(mem) {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // 1. Generate embedding
    const embedding = await embedText(mem.summary);
    const vectorStr = `[${embedding.join(",")}]`;
    
    // 2. Check for contradictions (pre-insert)
    const conflicts = await detectContradictions(mem);
    const autoResolved = [];
    const pendingContradictions = []; // Store for after insert
    
    for (const conflict of conflicts) {
      if (conflict.suggestedResolution.action === "a_supersedes") {
        // New memory supersedes existing
        mem.supersedes = [...(mem.supersedes || []), conflict.existingMemory.id];
        autoResolved.push({
          memory_id: conflict.existingMemory.id,
          resolution: "auto_superseded"
        });
      } else if (conflict.suggestedResolution.action === "pending") {
        // Defer recording until we have the new memory ID
        pendingContradictions.push({
          existingMemoryId: conflict.existingMemory.id,
          reason: conflict.reason
        });
      }
    }
    
    // 3. Insert memory unit
    const result = await client.query(`
      INSERT INTO memory_units (
        summary, 
        tier, 
        confidence,
        entities, 
        facts, 
        structured_facts,
        entity_links,
        valid_from,
        valid_to,
        base_importance,
        current_importance,
        supersedes,
        embedding
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12::vector)
      RETURNING id, summary, tier, confidence, created_at
    `, [
      mem.summary,
      mem.tier || "observed_fact",
      mem.confidence || 0.8,
      mem.entities || [],
      mem.facts || [],
      JSON.stringify(mem.structured_facts || []),
      JSON.stringify(mem.entity_links || []),
      mem.valid_from || null,
      mem.valid_to || null,
      mem.importance || 5,
      mem.supersedes || [],
      vectorStr
    ]);
    
    const insertedMemory = result.rows[0];
    const memoryId = insertedMemory.id;
    
    // 4. Mark superseded memories as inactive
    if (mem.supersedes?.length > 0) {
      await client.query(`
        UPDATE memory_units 
        SET is_active = false 
        WHERE id = ANY($1)
      `, [mem.supersedes]);
    }
    
    // 4b. Record pending contradictions (now that we have memoryId)
    for (const pending of pendingContradictions) {
      try {
        await recordContradiction(
          memoryId,
          pending.existingMemoryId,
          pending.reason,
          "pending"
        );
      } catch (err) {
        console.log("[Memory] Warning: Could not record contradiction:", err.message);
      }
    }
    
    // 5. Insert preferences (first-class in V3)
    if (mem.preferences?.length > 0) {
      for (const pref of mem.preferences) {
        await client.query(`
          INSERT INTO preferences (subject, entity, valence, strength, context, confidence, memory_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          "user",
          pref.entity,
          pref.valence,
          pref.strength || 0.5,
          pref.context || null,
          mem.confidence || 0.75,
          memoryId
        ]);
      }
    }
    
    // 6. Resolve and link entities
    if (mem.entities?.length > 0) {
      const resolved = await resolveEntities(mem.entities, mem.entity_links || []);
      await linkMemoryToEntities(memoryId, resolved);
    }
    
    // 7. Create relations to related memories
    if (mem.related_to?.length > 0) {
      for (const relatedId of mem.related_to) {
        await createRelation(memoryId, relatedId, "related_to", 0.8, true);
      }
    }
    
    // 8. Auto-discover relations based on entity overlap
    await discoverRelations(memoryId);
    
    await client.query("COMMIT");
    
    return {
      ...insertedMemory,
      conflicts_detected: conflicts.length,
      auto_resolved: autoResolved.length,
      preferences_stored: mem.preferences?.length || 0
    };
    
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ===========================================
// QUERY FUNCTIONS
// ===========================================

/**
 * Get all active memories (for debugging)
 */
export async function getAllMemories({ includeInactive = false } = {}) {
  const query = includeInactive
    ? `SELECT * FROM memory_units ORDER BY created_at DESC`
    : `SELECT * FROM memory_units WHERE is_active = true ORDER BY created_at DESC`;
  
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Get memory by ID
 */
export async function getMemoryById(id) {
  const result = await pool.query(`
    SELECT * FROM memory_units WHERE id = $1
  `, [id]);
  return result.rows[0];
}

/**
 * Get memories by tier
 */
export async function getMemoriesByTier(tier) {
  const result = await pool.query(`
    SELECT * FROM memory_units 
    WHERE tier = $1 AND is_active = true
    ORDER BY current_importance DESC
  `, [tier]);
  return result.rows;
}

/**
 * Get all entities
 */
export async function getAllEntities() {
  const result = await pool.query(`
    SELECT * FROM entities ORDER BY last_seen_at DESC
  `);
  return result.rows;
}

/**
 * Get memory statistics
 */
export async function getMemoryStats() {
  const stats = await pool.query(`
    SELECT 
      COUNT(*) as total_memories,
      COUNT(*) FILTER (WHERE is_active) as active_memories,
      COUNT(*) FILTER (WHERE tier = 'asserted_fact') as asserted_facts,
      COUNT(*) FILTER (WHERE tier = 'observed_fact') as observed_facts,
      COUNT(*) FILTER (WHERE tier = 'preference') as preferences_tier,
      COUNT(*) FILTER (WHERE tier = 'hypothesis') as hypotheses,
      AVG(current_importance) as avg_importance,
      AVG(confidence) as avg_confidence,
      MAX(created_at) as last_memory_at
    FROM memory_units
  `);
  
  const preferences = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE valence = 'positive') as positive,
      COUNT(*) FILTER (WHERE valence = 'negative') as negative
    FROM preferences WHERE is_active = true
  `);
  
  const entities = await pool.query(`
    SELECT COUNT(*) as total FROM entities
  `);
  
  const relations = await pool.query(`
    SELECT COUNT(*) as total FROM memory_relations
  `);
  
  return {
    memories: stats.rows[0],
    preferences: preferences.rows[0],
    entities: entities.rows[0],
    relations: relations.rows[0]
  };
}

/**
 * Update memory importance (for manual adjustment)
 */
export async function updateMemoryImportance(id, newImportance) {
  await pool.query(`
    UPDATE memory_units 
    SET base_importance = $2, current_importance = $2
    WHERE id = $1
  `, [id, newImportance]);
}

/**
 * Deactivate a memory
 */
export async function deactivateMemory(id) {
  await pool.query(`
    UPDATE memory_units SET is_active = false WHERE id = $1
  `, [id]);
}

