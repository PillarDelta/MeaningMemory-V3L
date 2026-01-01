// MeaningMemory V3 - Entity Resolution
// Cross-session entity linking and disambiguation

import pg from "pg";
import { config } from "./config.js";
import { embedText, cosineSimilarity } from "./embeddings.js";

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/**
 * Resolve entity mentions to canonical entities
 * Creates new entities or links to existing ones
 */
export async function resolveEntities(entityMentions, entityLinks = []) {
  const resolved = [];
  
  for (const mention of entityMentions) {
    const resolution = await resolveEntity(mention, entityLinks);
    resolved.push(resolution);
  }
  
  return resolved;
}

/**
 * Resolve a single entity mention
 */
async function resolveEntity(mention, entityLinks = []) {
  const mentionLower = mention.toLowerCase().trim();
  
  // First, check if entity_links provides explicit resolution
  const explicitLink = entityLinks.find(
    link => link.mention?.toLowerCase() === mentionLower
  );
  
  if (explicitLink?.canonical) {
    // Use the explicit canonical name
    const entity = await findOrCreateEntity(explicitLink.canonical, {
      alias: mention,
      relationship: explicitLink.relationship
    });
    
    return {
      mention,
      canonical: entity.canonical_name,
      entityId: entity.id,
      confidence: 0.95,
      source: "explicit_link"
    };
  }
  
  // Check for exact canonical match
  const exactMatch = await pool.query(`
    SELECT * FROM entities 
    WHERE LOWER(canonical_name) = $1
  `, [mentionLower]);
  
  if (exactMatch.rows.length > 0) {
    return {
      mention,
      canonical: exactMatch.rows[0].canonical_name,
      entityId: exactMatch.rows[0].id,
      confidence: 1.0,
      source: "exact_match"
    };
  }
  
  // Check for alias match
  const aliasMatch = await pool.query(`
    SELECT * FROM entities 
    WHERE $1 = ANY(SELECT LOWER(unnest(aliases)))
  `, [mentionLower]);
  
  if (aliasMatch.rows.length > 0) {
    return {
      mention,
      canonical: aliasMatch.rows[0].canonical_name,
      entityId: aliasMatch.rows[0].id,
      confidence: 0.9,
      source: "alias_match"
    };
  }
  
  // No match found - create new entity or return as unresolved
  // Only create if it looks like a proper noun (capitalized)
  if (mention[0] === mention[0].toUpperCase()) {
    const newEntity = await findOrCreateEntity(mention);
    return {
      mention,
      canonical: newEntity.canonical_name,
      entityId: newEntity.id,
      confidence: 0.7,
      source: "new_entity"
    };
  }
  
  // Return as unresolved (common noun or pronoun)
  return {
    mention,
    canonical: null,
    entityId: null,
    confidence: 0,
    source: "unresolved"
  };
}

/**
 * Find existing entity or create new one
 */
async function findOrCreateEntity(canonicalName, options = {}) {
  const { alias, relationship, entityType } = options;
  
  // Try to find existing
  const existing = await pool.query(`
    SELECT * FROM entities WHERE LOWER(canonical_name) = LOWER($1)
  `, [canonicalName]);
  
  if (existing.rows.length > 0) {
    const entity = existing.rows[0];
    
    // Add alias if provided and not already present
    if (alias && !entity.aliases.includes(alias)) {
      await pool.query(`
        UPDATE entities 
        SET aliases = array_append(aliases, $2),
            last_seen_at = NOW()
        WHERE id = $1
      `, [entity.id, alias]);
    }
    
    return entity;
  }
  
  // Create new entity
  const result = await pool.query(`
    INSERT INTO entities (canonical_name, aliases, entity_type)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [
    canonicalName,
    alias ? [alias] : [],
    entityType || inferEntityType(canonicalName)
  ]);
  
  return result.rows[0];
}

/**
 * Infer entity type from name/context
 */
function inferEntityType(name) {
  // Simple heuristics - could be enhanced with NER
  const nameLower = name.toLowerCase();
  
  // Common person name patterns
  if (/^(mr|mrs|ms|dr|prof)\.?\s/i.test(name)) {
    return "person";
  }
  
  // Location patterns
  if (/city|state|country|street|avenue|road/i.test(name)) {
    return "place";
  }
  
  // Company patterns
  if (/inc|corp|llc|ltd|company/i.test(name)) {
    return "organization";
  }
  
  // Default
  return "unknown";
}

/**
 * Link a memory to its resolved entities
 */
export async function linkMemoryToEntities(memoryId, resolvedEntities) {
  for (const entity of resolvedEntities) {
    if (entity.entityId) {
      await pool.query(`
        UPDATE entities
        SET memory_ids = array_append(memory_ids, $2)
        WHERE id = $1
          AND NOT ($2 = ANY(memory_ids))
      `, [entity.entityId, memoryId]);
    }
  }
}

/**
 * Get all memories for an entity
 */
export async function getMemoriesForEntity(entityIdOrName) {
  // First find the entity
  let entity;
  
  // Try by ID
  if (entityIdOrName.match(/^[0-9a-f-]{36}$/i)) {
    const result = await pool.query(`
      SELECT * FROM entities WHERE id = $1
    `, [entityIdOrName]);
    entity = result.rows[0];
  } else {
    // Try by name
    const result = await pool.query(`
      SELECT * FROM entities 
      WHERE LOWER(canonical_name) = LOWER($1)
        OR $1 = ANY(SELECT LOWER(unnest(aliases)))
    `, [entityIdOrName]);
    entity = result.rows[0];
  }
  
  if (!entity) {
    return { entity: null, memories: [] };
  }
  
  // Get all linked memories
  const memories = await pool.query(`
    SELECT * FROM memory_units
    WHERE id = ANY($1)
      AND is_active = true
    ORDER BY created_at DESC
  `, [entity.memory_ids]);
  
  return {
    entity,
    memories: memories.rows
  };
}

/**
 * Merge two entities (when discovered to be the same)
 */
export async function mergeEntities(sourceId, targetId) {
  // Get both entities
  const [source, target] = await Promise.all([
    pool.query(`SELECT * FROM entities WHERE id = $1`, [sourceId]),
    pool.query(`SELECT * FROM entities WHERE id = $1`, [targetId])
  ]);
  
  if (!source.rows[0] || !target.rows[0]) {
    throw new Error("Entity not found");
  }
  
  const sourceEntity = source.rows[0];
  const targetEntity = target.rows[0];
  
  // Merge aliases
  const allAliases = [...new Set([
    ...targetEntity.aliases,
    ...sourceEntity.aliases,
    sourceEntity.canonical_name
  ])];
  
  // Merge memory_ids
  const allMemoryIds = [...new Set([
    ...targetEntity.memory_ids,
    ...sourceEntity.memory_ids
  ])];
  
  // Update target
  await pool.query(`
    UPDATE entities
    SET aliases = $2,
        memory_ids = $3
    WHERE id = $1
  `, [targetId, allAliases, allMemoryIds]);
  
  // Delete source
  await pool.query(`
    DELETE FROM entities WHERE id = $1
  `, [sourceId]);
  
  return { merged: true, targetId };
}

/**
 * Add alias to existing entity
 */
export async function addEntityAlias(entityId, alias) {
  await pool.query(`
    UPDATE entities
    SET aliases = array_append(aliases, $2)
    WHERE id = $1
      AND NOT ($2 = ANY(aliases))
  `, [entityId, alias]);
}

/**
 * Confirm an entity (user verified)
 */
export async function confirmEntity(entityId) {
  await pool.query(`
    UPDATE entities
    SET confirmed = true, confidence = 1.0
    WHERE id = $1
  `, [entityId]);
}

