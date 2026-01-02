-- Migration: Add absorption tracking columns to memory_units
-- Run this on existing V3-L databases to enable LLM absorption

-- Add the absorbed tracking columns
ALTER TABLE memory_units 
ADD COLUMN IF NOT EXISTS absorbed BOOLEAN DEFAULT false;

ALTER TABLE memory_units 
ADD COLUMN IF NOT EXISTS absorbed_at TIMESTAMPTZ;

-- Create index for efficient queries of unabsorbed memories
CREATE INDEX IF NOT EXISTS idx_memory_unabsorbed
  ON memory_units (absorbed) 
  WHERE absorbed = false AND is_active = true;

-- Verify
SELECT 
  COUNT(*) as total_memories,
  COUNT(*) FILTER (WHERE absorbed = false) as unabsorbed,
  COUNT(*) FILTER (WHERE absorbed = true) as absorbed
FROM memory_units;




