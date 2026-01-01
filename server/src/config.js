// MeaningMemory V3-L Configuration
// Local Memory LLM (Phi-3) + Cloud Interaction LLM (Grok)

export const config = {
  // Server (different port from V3)
  PORT: process.env.PORT || 3335,
  
  // Database (different port from V3)
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5434/meaning_memory_v3l",
  
  // === LOCAL LLM (Ollama/Phi-3) for Memory Agent ===
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  OLLAMA_MEMORY_MODEL: process.env.OLLAMA_MEMORY_MODEL || "phi3:mini",
  USE_LOCAL_MEMORY_LLM: process.env.USE_LOCAL_MEMORY_LLM !== "false", // Default: true
  
  // === CLOUD LLM for Interaction Agent ===
  // Default: xAI/Grok, but any OpenAI-compatible API works
  // Examples: OpenAI, Anthropic, Groq, Together AI, local Ollama
  XAI_API_KEY: process.env.XAI_API_KEY,
  XAI_BASE_URL: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  XAI_INTERACTION_MODEL: process.env.XAI_INTERACTION_MODEL || "grok-3-fast",
  
  // Fallback: Use Grok for memory if Ollama unavailable
  XAI_MEMORY_MODEL: process.env.XAI_MEMORY_MODEL || "grok-3-mini-fast",
  
  // Local Embeddings (unchanged)
  EMBED_MODEL: "Xenova/bge-small-en-v1.5",
  EMBED_DIMENSIONS: 384,
  
  // V3: Decay Parameters
  DECAY_RATE: 0.05,
  REINFORCEMENT_BONUS: 0.3,
  IMPORTANCE_FLOOR: 1.0,
  DECAY_INTERVAL_HOURS: 6,
  
  // V3: Retrieval Parameters
  RETRIEVAL_K: 5,
  SIMILARITY_THRESHOLD: 0.3,
  SPREADING_DEPTH: 2,
  SPREADING_DECAY: 0.5,
  
  // V3: Belief Tier Confidence Floors
  TIER_FLOORS: {
    asserted_fact: 0.90,
    observed_fact: 0.80,
    preference: 0.75,
    hypothesis: 0.50,
    temporary_context: 0.40
  }
};
