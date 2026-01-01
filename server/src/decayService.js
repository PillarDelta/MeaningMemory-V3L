// MeaningMemory V3 - Memory Decay Service
// Implements exponential decay with reinforcement from the theoretical paper

import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/**
 * Calculate decayed importance for a single memory
 * Formula: S(t) = S₀ · e^(-λt) + β · Σr(t) + floor
 * 
 * Where:
 * - S₀ = base_importance
 * - λ = decay_rate
 * - t = days since creation
 * - β = reinforcement_bonus per access
 * - r(t) = access recency factor
 */
export function calculateDecayedImportance(memory) {
  const now = Date.now();
  const createdAt = new Date(memory.created_at).getTime();
  const lastAccessed = memory.last_accessed_at 
    ? new Date(memory.last_accessed_at).getTime() 
    : createdAt;
  
  const daysSinceCreation = (now - createdAt) / (1000 * 60 * 60 * 24);
  const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);
  
  // Exponential decay from base importance
  const baseDecayed = memory.base_importance * Math.exp(-config.DECAY_RATE * daysSinceCreation);
  
  // Reinforcement bonus (diminishes with time since last access)
  let reinforcement = 0;
  if (daysSinceAccess < 7) {
    // Recent access provides bonus, capped at 10 accesses
    const accessFactor = Math.min(memory.access_count || 0, 10);
    const recencyFactor = 1 - (daysSinceAccess / 7);
    reinforcement = config.REINFORCEMENT_BONUS * accessFactor * recencyFactor;
  }
  
  // Apply floor
  const finalImportance = Math.max(
    baseDecayed + reinforcement,
    config.IMPORTANCE_FLOOR
  );
  
  return {
    importance: finalImportance,
    baseDecayed,
    reinforcement,
    daysSinceCreation,
    daysSinceAccess
  };
}

/**
 * Run decay update on all active memories
 * Should be called periodically (e.g., every 6 hours)
 */
export async function runDecayUpdate() {
  console.log("[Decay] Running importance decay update...");
  
  const result = await pool.query(`
    UPDATE memory_units
    SET 
      current_importance = calculate_decayed_importance(
        base_importance,
        last_decay_at,
        access_count,
        last_accessed_at,
        $1::float,
        $2::float,
        $3::float
      ),
      last_decay_at = NOW()
    WHERE is_active = true
    RETURNING id, summary, base_importance, current_importance
  `, [config.DECAY_RATE, config.REINFORCEMENT_BONUS, config.IMPORTANCE_FLOOR]);
  
  console.log(`[Decay] Updated ${result.rowCount} memories`);
  
  // Log significant changes
  for (const row of result.rows) {
    if (row.current_importance < row.base_importance * 0.5) {
      console.log(`[Decay] Low importance: "${row.summary.substring(0, 50)}..." (${row.current_importance.toFixed(2)})`);
    }
  }
  
  return result.rows;
}

/**
 * Apply reinforcement when a memory is accessed
 */
export async function reinforceMemory(memoryId) {
  const result = await pool.query(`
    UPDATE memory_units
    SET 
      access_count = access_count + 1,
      last_accessed_at = NOW()
    WHERE id = $1
    RETURNING id, access_count
  `, [memoryId]);
  
  return result.rows[0];
}

/**
 * Batch reinforce memories (called after retrieval)
 */
export async function reinforceMemories(memoryIds) {
  if (!memoryIds || memoryIds.length === 0) return;
  
  await pool.query(`
    UPDATE memory_units
    SET 
      access_count = access_count + 1,
      last_accessed_at = NOW()
    WHERE id = ANY($1)
  `, [memoryIds]);
}

/**
 * Get memories that have decayed below threshold
 * These could be candidates for archival or cleanup
 */
export async function getLowImportanceMemories(threshold = 2.0) {
  const result = await pool.query(`
    SELECT id, summary, tier, current_importance, access_count, created_at
    FROM memory_units
    WHERE is_active = true
      AND current_importance < $1
    ORDER BY current_importance ASC
  `, [threshold]);
  
  return result.rows;
}

/**
 * Archive old, low-importance memories
 * Marks them inactive but preserves for audit
 */
export async function archiveLowImportanceMemories(threshold = 1.5, maxAgeDays = 90) {
  const result = await pool.query(`
    UPDATE memory_units
    SET is_active = false
    WHERE is_active = true
      AND current_importance < $1
      AND created_at < NOW() - INTERVAL '1 day' * $2
    RETURNING id, summary
  `, [threshold, maxAgeDays]);
  
  if (result.rowCount > 0) {
    console.log(`[Decay] Archived ${result.rowCount} low-importance memories`);
  }
  
  return result.rows;
}

/**
 * Start periodic decay service
 */
export function startDecayService() {
  const intervalMs = config.DECAY_INTERVAL_HOURS * 60 * 60 * 1000;
  
  console.log(`[Decay] Starting decay service (interval: ${config.DECAY_INTERVAL_HOURS}h)`);
  
  // Run immediately on start
  runDecayUpdate().catch(err => console.error("[Decay] Error:", err));
  
  // Then run periodically
  setInterval(() => {
    runDecayUpdate().catch(err => console.error("[Decay] Error:", err));
  }, intervalMs);
}

