// MeaningMemory V3 - Local Embeddings (BGE-small-en-v1.5)

import { pipeline } from "@xenova/transformers";
import { config } from "./config.js";

let localEmbedder = null;
let isInitializing = false;
let initPromise = null;

/**
 * Initialize the local embedding model
 * Downloads ~130MB on first run, then cached
 */
export async function initEmbedder() {
  if (localEmbedder) return localEmbedder;
  
  if (isInitializing) {
    return initPromise;
  }
  
  isInitializing = true;
  console.log(`[Embeddings] Loading: ${config.EMBED_MODEL}`);
  
  initPromise = pipeline("feature-extraction", config.EMBED_MODEL);
  localEmbedder = await initPromise;
  
  console.log("[Embeddings] Model loaded ✅");
  isInitializing = false;
  
  return localEmbedder;
}

/**
 * Generate embedding for text
 * @returns {Promise<number[]>} 384-dimensional vector
 */
export async function embedText(text) {
  const embedder = await initEmbedder();
  
  const output = await embedder(text, {
    pooling: "mean",
    normalize: true
  });
  
  return Array.from(output.data);
}

/**
 * Generate embeddings for multiple texts
 * @returns {Promise<number[][]>} Array of 384-dimensional vectors
 */
export async function embedTexts(texts) {
  const embedder = await initEmbedder();
  
  const results = [];
  for (const text of texts) {
    const output = await embedder(text, {
      pooling: "mean",
      normalize: true
    });
    results.push(Array.from(output.data));
  }
  
  return results;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

