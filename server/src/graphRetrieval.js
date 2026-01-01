// MeaningMemory V3 - Graph-Based Retrieval
// Implements spreading activation for semantic priming

import pg from "pg";
import { config } from "./config.js";
import { embedText } from "./embeddings.js";

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/**
 * Enhanced retrieval with spreading activation
 * 
 * Formula from paper:
 * ρ(Q) = argmax [sim(Q, M) + Σ path_weight(M, M') * sim(Q, M')]
 * 
 * Where path_weight decays with distance in the graph
 */
export async function retrieveWithSpreadingActivation({ 
  queryText, 
  k = config.RETRIEVAL_K,
  depth = config.SPREADING_DEPTH,
  spreadingDecay = config.SPREADING_DECAY
}) {
  // Step 1: Get embedding for query
  const embedding = await embedText(queryText);
  const vectorStr = `[${embedding.join(",")}]`;
  
  // Step 2: Direct vector + keyword search (base scores)
  const directResults = await pool.query(`
    SELECT 
      m.id, 
      m.summary, 
      m.entities, 
      m.facts,
      m.structured_facts,
      m.tier,
      m.confidence,
      m.current_importance,
      m.access_count,
      (0.6 * (1 - (m.embedding <=> $1::vector))) +
      (0.2 * COALESCE(ts_rank(to_tsvector('english', m.summary), plainto_tsquery('english', $3)), 0)) +
      (0.2 * (m.current_importance / 10.0))
      AS base_score
    FROM memory_units m
    WHERE m.is_active = true
    ORDER BY base_score DESC
    LIMIT $2
  `, [vectorStr, k * 2, queryText]);  // Get 2x for spreading
  
  if (directResults.rows.length === 0) {
    return [];
  }
  
  // Step 3: Spreading activation through relations
  const directIds = directResults.rows.map(r => r.id);
  const spreadScores = new Map();
  
  // Initialize with direct scores
  for (const row of directResults.rows) {
    spreadScores.set(row.id, {
      memory: row,
      score: row.base_score,
      sources: ["direct"]
    });
  }
  
  // Spread activation through graph
  if (depth > 0) {
    await spreadActivation(directIds, spreadScores, vectorStr, depth, spreadingDecay);
  }
  
  // Step 4: Combine and rank
  const combined = Array.from(spreadScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  
  return combined.map(c => ({
    ...c.memory,
    combined_score: c.score,
    activation_sources: c.sources
  }));
}

/**
 * Spread activation to related memories
 */
async function spreadActivation(sourceIds, scoreMap, queryVector, depth, decay) {
  if (depth <= 0 || sourceIds.length === 0) return;
  
  // Find related memories
  const relations = await pool.query(`
    SELECT 
      r.source_id,
      r.target_id,
      r.relation_type,
      r.weight,
      m.id,
      m.summary,
      m.entities,
      m.facts,
      m.structured_facts,
      m.tier,
      m.confidence,
      m.current_importance,
      m.access_count,
      1 - (m.embedding <=> $1::vector) as similarity
    FROM memory_relations r
    JOIN memory_units m ON (
      (r.source_id = ANY($2) AND m.id = r.target_id) OR
      (r.target_id = ANY($2) AND m.id = r.source_id AND r.bidirectional = true)
    )
    WHERE m.is_active = true
      AND m.id != ALL($2)
  `, [queryVector, sourceIds]);
  
  const newIds = [];
  
  for (const rel of relations.rows) {
    const spreadScore = rel.similarity * rel.weight * decay;
    
    if (scoreMap.has(rel.id)) {
      // Add to existing score
      const existing = scoreMap.get(rel.id);
      existing.score += spreadScore;
      existing.sources.push(`spread_${rel.relation_type}`);
    } else {
      // New memory discovered through spreading
      scoreMap.set(rel.id, {
        memory: {
          id: rel.id,
          summary: rel.summary,
          entities: rel.entities,
          facts: rel.facts,
          structured_facts: rel.structured_facts,
          tier: rel.tier,
          confidence: rel.confidence,
          current_importance: rel.current_importance,
          access_count: rel.access_count
        },
        score: spreadScore,
        sources: [`spread_${rel.relation_type}`]
      });
      newIds.push(rel.id);
    }
  }
  
  // Recurse with reduced depth
  if (newIds.length > 0) {
    await spreadActivation(newIds, scoreMap, queryVector, depth - 1, decay * decay);
  }
}

/**
 * Create a relation between two memories
 */
export async function createRelation(sourceId, targetId, relationType, weight = 1.0, bidirectional = true) {
  await pool.query(`
    INSERT INTO memory_relations (source_id, target_id, relation_type, weight, bidirectional)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (source_id, target_id, relation_type) 
    DO UPDATE SET weight = GREATEST(memory_relations.weight, $4)
  `, [sourceId, targetId, relationType, weight, bidirectional]);
}

/**
 * Auto-discover relations between memories based on entity overlap
 */
export async function discoverRelations(memoryId) {
  const memory = await pool.query(`
    SELECT * FROM memory_units WHERE id = $1
  `, [memoryId]);
  
  if (!memory.rows[0]) return [];
  
  const entities = memory.rows[0].entities || [];
  if (entities.length === 0) return [];
  
  // Find memories with overlapping entities
  const related = await pool.query(`
    SELECT id, entities, summary
    FROM memory_units
    WHERE id != $1
      AND is_active = true
      AND entities && $2  -- Array overlap
    LIMIT 10
  `, [memoryId, entities]);
  
  const newRelations = [];
  
  for (const rel of related.rows) {
    // Calculate overlap weight
    const overlap = entities.filter(e => rel.entities.includes(e)).length;
    const weight = overlap / Math.max(entities.length, rel.entities.length);
    
    if (weight >= 0.3) {  // Minimum overlap threshold
      await createRelation(memoryId, rel.id, "related_to", weight, true);
      newRelations.push({
        targetId: rel.id,
        targetSummary: rel.summary,
        weight
      });
    }
  }
  
  return newRelations;
}

/**
 * Get all relations for a memory
 */
export async function getMemoryRelations(memoryId) {
  const result = await pool.query(`
    SELECT 
      r.*,
      m.summary as related_summary
    FROM memory_relations r
    JOIN memory_units m ON (
      (r.source_id = $1 AND m.id = r.target_id) OR
      (r.target_id = $1 AND m.id = r.source_id AND r.bidirectional = true)
    )
    WHERE m.is_active = true
    ORDER BY r.weight DESC
  `, [memoryId]);
  
  return result.rows;
}

/**
 * Simple retrieval (for backwards compatibility)
 * Uses spreading activation under the hood
 */
export async function retrieveMemories({ queryText, k = config.RETRIEVAL_K }) {
  return retrieveWithSpreadingActivation({ queryText, k });
}

