-- ===========================================
-- MEANING MEMORY V3 SCHEMA
-- Full theoretical implementation
-- ===========================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================
-- 1. BELIEF TIER ENUM
-- ===========================================
DO $$ BEGIN
  CREATE TYPE belief_tier AS ENUM (
    'asserted_fact',      -- 0.90 floor - User explicitly stated
    'observed_fact',      -- 0.80 floor - Inferred from behavior
    'preference',         -- 0.75 floor - Likes/dislikes
    'hypothesis',         -- 0.50 max  - Uncertain inference
    'temporary_context'   -- 0.40 floor - Session-bound
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- 2. ENTITIES TABLE (Activated in V3)
-- ===========================================
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  aliases TEXT[] DEFAULT '{}',
  entity_type TEXT,                    -- 'person', 'place', 'thing', 'concept'
  confidence FLOAT DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  confirmed BOOLEAN DEFAULT false,     -- User confirmed this entity mapping?
  description TEXT,                    -- Brief description
  memory_ids UUID[] DEFAULT '{}',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_canonical 
  ON entities (canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_aliases 
  ON entities USING gin(aliases);

-- ===========================================
-- 3. MEMORY UNITS TABLE (V3 Enhanced)
-- ===========================================
CREATE TABLE IF NOT EXISTS memory_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Core Content
  summary TEXT NOT NULL,
  entities TEXT[] DEFAULT '{}',
  facts TEXT[] DEFAULT '{}',
  
  -- V3: Belief Management
  tier belief_tier DEFAULT 'observed_fact',
  confidence FLOAT DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  
  -- V3: Temporal Validity
  valid_from TIMESTAMPTZ,              -- When the fact became true
  valid_to TIMESTAMPTZ,                -- When it stopped being true (NULL = still valid)
  
  -- V3: Importance & Decay
  base_importance FLOAT DEFAULT 5.0 CHECK (base_importance >= 1 AND base_importance <= 10),
  current_importance FLOAT DEFAULT 5.0,
  last_decay_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- V3: Access Tracking (Activated)
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  
  -- Structured Data
  structured_facts JSONB DEFAULT '[]',
  entity_links JSONB DEFAULT '[]',
  
  -- Provenance
  source_conversation_id TEXT,         -- Link back to conversation
  
  -- Embedding
  embedding vector(384) NOT NULL,
  
  -- State
  is_active BOOLEAN DEFAULT true,
  supersedes UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memory_embedding
  ON memory_units USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_memory_active
  ON memory_units (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_memory_tier
  ON memory_units (tier);
CREATE INDEX IF NOT EXISTS idx_memory_importance
  ON memory_units (current_importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_fts
  ON memory_units USING gin(to_tsvector('english', summary));

-- ===========================================
-- 4. PREFERENCES TABLE (First-class in V3)
-- ===========================================
CREATE TABLE IF NOT EXISTS preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,               -- Who has the preference (usually 'user')
  entity TEXT NOT NULL,                -- What the preference is about
  valence TEXT CHECK (valence IN ('positive', 'negative', 'neutral')),
  strength FLOAT DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  context TEXT,                        -- "for breakfast", "at work", etc.
  confidence FLOAT DEFAULT 0.75,
  memory_id UUID REFERENCES memory_units(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  superseded_by UUID REFERENCES preferences(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preferences_entity
  ON preferences (entity);
CREATE INDEX IF NOT EXISTS idx_preferences_active
  ON preferences (is_active) WHERE is_active = true;

-- ===========================================
-- 5. MEMORY RELATIONS TABLE (Graph in V3)
-- ===========================================
CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES memory_units(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES memory_units(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,         -- 'related_to', 'elaborates', 'supports', 'temporal_sequence'
  weight FLOAT DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
  bidirectional BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_source
  ON memory_relations (source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target
  ON memory_relations (target_id);

-- ===========================================
-- 6. CONTRADICTIONS TABLE (Explicit in V3)
-- ===========================================
CREATE TABLE IF NOT EXISTS contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_a UUID NOT NULL REFERENCES memory_units(id) ON DELETE CASCADE,
  memory_b UUID NOT NULL REFERENCES memory_units(id) ON DELETE CASCADE,
  field_path TEXT,                     -- Which field conflicts (e.g., 'facts[0]')
  reason TEXT NOT NULL,
  resolution TEXT DEFAULT 'pending' CHECK (resolution IN (
    'pending',
    'a_supersedes',
    'b_supersedes', 
    'coexist',
    'merged',
    'user_resolved'
  )),
  resolution_note TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contradictions_pending
  ON contradictions (resolution) WHERE resolution = 'pending';

-- ===========================================
-- 7. DECAY LOG (For debugging/tuning)
-- ===========================================
CREATE TABLE IF NOT EXISTS decay_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID REFERENCES memory_units(id) ON DELETE CASCADE,
  old_importance FLOAT,
  new_importance FLOAT,
  decay_factor FLOAT,
  reinforcement FLOAT,
  run_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Function to calculate decayed importance
CREATE OR REPLACE FUNCTION calculate_decayed_importance(
  base_imp FLOAT,
  last_decay TIMESTAMPTZ,
  access_cnt INTEGER,
  last_access TIMESTAMPTZ,
  decay_rate FLOAT DEFAULT 0.05,
  reinforce_bonus FLOAT DEFAULT 0.3,
  floor_val FLOAT DEFAULT 1.0
) RETURNS FLOAT AS $$
DECLARE
  days_since_decay FLOAT;
  days_since_access FLOAT;
  decayed FLOAT;
  reinforcement FLOAT;
BEGIN
  days_since_decay := EXTRACT(EPOCH FROM (NOW() - last_decay)) / 86400.0;
  days_since_access := CASE 
    WHEN last_access IS NULL THEN 999
    ELSE EXTRACT(EPOCH FROM (NOW() - last_access)) / 86400.0
  END;
  
  -- Exponential decay
  decayed := base_imp * EXP(-decay_rate * days_since_decay);
  
  -- Reinforcement bonus for recent access (within 7 days)
  reinforcement := CASE 
    WHEN days_since_access < 7 THEN reinforce_bonus * LEAST(access_cnt, 10) * (1 - days_since_access / 7)
    ELSE 0
  END;
  
  RETURN GREATEST(decayed + reinforcement, floor_val);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

