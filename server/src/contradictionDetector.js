// MeaningMemory V3 - Contradiction Detection
// Implements Axiom 4: Contradiction Exclusion

import pg from "pg";
import { config } from "./config.js";
import { embedText, cosineSimilarity } from "./embeddings.js";
import { getTierPriority } from "./beliefTiering.js";

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// Similarity threshold for potential contradiction
const CONTRADICTION_THRESHOLD = 0.75;

/**
 * Resolution strategies from the theoretical paper:
 * 1. User Correction Override - explicit corrections win
 * 2. Temporal Validity - newer supersedes older for time-sensitive facts
 * 3. Preference Clarification - ask user when unsure
 * 4. Tier Hierarchy - higher tier wins
 * 5. Coexistence Default - both can be true in different contexts
 */
export const RESOLUTION_STRATEGIES = {
  USER_CORRECTION: "user_correction",
  TEMPORAL: "temporal",
  TIER_HIERARCHY: "tier_hierarchy",
  COEXIST: "coexist",
  MERGE: "merge"
};

// Patterns that indicate user identity statements
const IDENTITY_PATTERNS = [
  /user'?s?\s+name\s+is\s+(\w+)/i,
  /my\s+name\s+is\s+(\w+)/i,
  /i\s+am\s+(\w+)/i,
  /call\s+me\s+(\w+)/i,
  /(\w+)\s+introduces\s+(?:himself|herself|themselves)/i
];

/**
 * Extract user name from memory content
 */
function extractUserName(memory) {
  const textToSearch = `${memory.summary || ''} ${(memory.facts || []).join(' ')}`;
  
  for (const pattern of IDENTITY_PATTERNS) {
    const match = textToSearch.match(pattern);
    if (match && match[1]) {
      // Filter out common non-name words
      const name = match[1];
      const skipWords = ['user', 'asking', 'the', 'a', 'an', 'here', 'there'];
      if (!skipWords.includes(name.toLowerCase())) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Detect potential contradictions before inserting a new memory
 * Returns array of potential conflicts with resolution suggestions
 */
export async function detectContradictions(newMemory) {
  const { summary, structured_facts, entities, tier } = newMemory;
  
  const conflicts = [];
  
  // 0. Check for identity contradictions first
  const newUserName = extractUserName(newMemory);
  if (newUserName) {
    // Look for existing identity memories
    const identityMemories = await pool.query(`
      SELECT id, summary, facts, tier, confidence, created_at
      FROM memory_units
      WHERE is_active = true
        AND (
          summary ILIKE '%name is%'
          OR summary ILIKE '%I am%'
          OR summary ILIKE '%introduces%'
          OR array_to_string(facts, ' ') ILIKE '%name is%'
        )
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    for (const existing of identityMemories.rows) {
      const existingName = extractUserName(existing);
      if (existingName && existingName.toLowerCase() !== newUserName.toLowerCase()) {
        console.log(`[Contradiction] ⚠️ Identity conflict: "${existingName}" vs "${newUserName}"`);
        conflicts.push({
          existingMemory: existing,
          similarity: 0.95,
          conflictType: "identity_conflict",
          reason: `User name changed from "${existingName}" to "${newUserName}"`,
          suggestedResolution: {
            strategy: "TEMPORAL",
            action: "a_supersedes",  // New identity supersedes old
            reason: "User corrected their name"
          },
          fields: [{ field: "user.name", oldValue: existingName, newValue: newUserName }]
        });
      }
    }
  }
  
  // 1. Find semantically similar memories
  const embedding = await embedText(summary);
  const vectorStr = `[${embedding.join(",")}]`;
  
  const similarMemories = await pool.query(`
    SELECT 
      id, summary, structured_facts, entities, tier, confidence,
      1 - (embedding <=> $1::vector) as similarity
    FROM memory_units
    WHERE is_active = true
      AND 1 - (embedding <=> $1::vector) > $2
    ORDER BY similarity DESC
    LIMIT 10
  `, [vectorStr, CONTRADICTION_THRESHOLD]);
  
  // 2. Check each similar memory for semantic conflicts
  for (const existing of similarMemories.rows) {
    const conflict = analyzeConflict(newMemory, existing);
    
    if (conflict.isContradiction) {
      conflicts.push({
        existingMemory: existing,
        similarity: existing.similarity,
        conflictType: conflict.type,
        reason: conflict.reason,
        suggestedResolution: conflict.resolution,
        fields: conflict.conflictingFields
      });
    }
  }
  
  return conflicts;
}

/**
 * Analyze two memories for semantic conflict
 */
function analyzeConflict(newMemory, existingMemory) {
  const result = {
    isContradiction: false,
    type: null,
    reason: null,
    resolution: null,
    conflictingFields: []
  };
  
  // Check structured facts for direct contradictions
  if (newMemory.structured_facts && existingMemory.structured_facts) {
    const newFacts = Array.isArray(newMemory.structured_facts) 
      ? newMemory.structured_facts 
      : JSON.parse(newMemory.structured_facts || "[]");
    const existingFacts = Array.isArray(existingMemory.structured_facts)
      ? existingMemory.structured_facts
      : JSON.parse(existingMemory.structured_facts || "[]");
    
    for (const newFact of newFacts) {
      for (const existingFact of existingFacts) {
        // Same subject and predicate but different object = potential contradiction
        if (
          newFact.subject?.toLowerCase() === existingFact.subject?.toLowerCase() &&
          newFact.predicate?.toLowerCase() === existingFact.predicate?.toLowerCase() &&
          newFact.object?.toLowerCase() !== existingFact.object?.toLowerCase()
        ) {
          result.isContradiction = true;
          result.type = "fact_conflict";
          result.reason = `Conflicting values for ${newFact.subject}.${newFact.predicate}: "${existingFact.object}" vs "${newFact.object}"`;
          result.conflictingFields.push({
            field: `${newFact.subject}.${newFact.predicate}`,
            oldValue: existingFact.object,
            newValue: newFact.object
          });
          
          // Determine resolution
          result.resolution = determineResolution(newMemory, existingMemory, newFact, existingFact);
        }
      }
    }
  }
  
  // Check for entity-level contradictions (same entity, conflicting attributes)
  // This is a simpler heuristic check
  const newEntities = new Set((newMemory.entities || []).map(e => e.toLowerCase()));
  const existingEntities = new Set((existingMemory.entities || []).map(e => e.toLowerCase()));
  
  // If high overlap in entities and high similarity, check for value conflicts
  const entityOverlap = [...newEntities].filter(e => existingEntities.has(e));
  
  if (entityOverlap.length > 0 && !result.isContradiction) {
    // High entity overlap + high similarity but different summaries might be a conflict
    // This is a softer check - flag for review
    if (existingMemory.similarity > 0.85 && newMemory.summary !== existingMemory.summary) {
      result.isContradiction = true;
      result.type = "potential_update";
      result.reason = `Similar memories about: ${entityOverlap.join(", ")}`;
      result.resolution = determineResolution(newMemory, existingMemory);
    }
  }
  
  return result;
}

/**
 * Determine the best resolution strategy
 */
function determineResolution(newMemory, existingMemory, newFact = null, existingFact = null) {
  // Rule 1: Temporal - if facts have temporal markers, newer wins
  if (newFact?.temporal === "current" && existingFact?.temporal === "past") {
    return {
      strategy: RESOLUTION_STRATEGIES.TEMPORAL,
      action: "a_supersedes",  // new supersedes existing
      reason: "New fact marked as current, existing marked as past"
    };
  }
  
  // Rule 2: Tier hierarchy - higher tier wins
  const newPriority = getTierPriority(newMemory.tier);
  const existingPriority = getTierPriority(existingMemory.tier);
  
  if (newPriority > existingPriority) {
    return {
      strategy: RESOLUTION_STRATEGIES.TIER_HIERARCHY,
      action: "a_supersedes",
      reason: `New memory tier (${newMemory.tier}) outranks existing (${existingMemory.tier})`
    };
  } else if (existingPriority > newPriority) {
    return {
      strategy: RESOLUTION_STRATEGIES.TIER_HIERARCHY,
      action: "b_supersedes",
      reason: `Existing memory tier (${existingMemory.tier}) outranks new (${newMemory.tier})`
    };
  }
  
  // Rule 3: Confidence - higher confidence wins
  const newConf = newMemory.confidence || 0.5;
  const existingConf = existingMemory.confidence || 0.5;
  
  if (Math.abs(newConf - existingConf) > 0.2) {
    if (newConf > existingConf) {
      return {
        strategy: RESOLUTION_STRATEGIES.TIER_HIERARCHY,
        action: "a_supersedes",
        reason: `New memory confidence (${newConf}) higher than existing (${existingConf})`
      };
    } else {
      return {
        strategy: RESOLUTION_STRATEGIES.TIER_HIERARCHY,
        action: "b_supersedes",
        reason: `Existing memory confidence (${existingConf}) higher than new (${newConf})`
      };
    }
  }
  
  // Default: Coexist or flag for user review
  return {
    strategy: RESOLUTION_STRATEGIES.COEXIST,
    action: "pending",
    reason: "Unable to auto-resolve, marking for review"
  };
}

/**
 * Record a detected contradiction
 */
export async function recordContradiction(memoryA, memoryB, reason, resolution = "pending") {
  const result = await pool.query(`
    INSERT INTO contradictions (memory_a, memory_b, reason, resolution)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [memoryA, memoryB, reason, resolution]);
  
  return result.rows[0];
}

/**
 * Resolve a contradiction
 */
export async function resolveContradiction(contradictionId, resolution, note = null) {
  await pool.query(`
    UPDATE contradictions
    SET resolution = $2, resolution_note = $3, resolved_at = NOW()
    WHERE id = $1
  `, [contradictionId, resolution, note]);
  
  // Apply resolution effects
  const contradiction = await pool.query(`
    SELECT * FROM contradictions WHERE id = $1
  `, [contradictionId]);
  
  if (contradiction.rows[0]) {
    const c = contradiction.rows[0];
    
    if (resolution === "a_supersedes") {
      await pool.query(`
        UPDATE memory_units SET is_active = false WHERE id = $1
      `, [c.memory_b]);
      await pool.query(`
        UPDATE memory_units SET supersedes = array_append(supersedes, $2) WHERE id = $1
      `, [c.memory_a, c.memory_b]);
    } else if (resolution === "b_supersedes") {
      await pool.query(`
        UPDATE memory_units SET is_active = false WHERE id = $1
      `, [c.memory_a]);
      await pool.query(`
        UPDATE memory_units SET supersedes = array_append(supersedes, $2) WHERE id = $1
      `, [c.memory_b, c.memory_a]);
    }
  }
}

/**
 * Get pending contradictions
 */
export async function getPendingContradictions() {
  const result = await pool.query(`
    SELECT 
      c.*,
      ma.summary as summary_a,
      mb.summary as summary_b
    FROM contradictions c
    JOIN memory_units ma ON c.memory_a = ma.id
    JOIN memory_units mb ON c.memory_b = mb.id
    WHERE c.resolution = 'pending'
    ORDER BY c.detected_at DESC
  `);
  
  return result.rows;
}

