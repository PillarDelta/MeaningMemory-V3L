// MeaningMemory V3 - Belief Tiering System
// Implements the 5-tier confidence model from the theoretical paper

import { config } from "./config.js";

/**
 * Belief Tier Definitions
 * Each tier has a confidence floor and specific characteristics
 */
export const TIERS = {
  asserted_fact: {
    name: "Asserted Fact",
    floor: 0.90,
    description: "User explicitly stated this as true",
    indicators: ["I am", "My name is", "I have", "I work at", "I live in"],
    canPromote: false,  // Already highest
    canDemote: true
  },
  observed_fact: {
    name: "Observed Fact", 
    floor: 0.80,
    description: "Inferred from consistent behavior or context",
    indicators: ["based on", "you mentioned", "previously"],
    canPromote: true,   // Can become asserted if user confirms
    canDemote: true
  },
  preference: {
    name: "Preference",
    floor: 0.75,
    description: "User likes/dislikes something",
    indicators: ["I like", "I love", "I hate", "I prefer", "my favorite", "I don't like"],
    canPromote: true,
    canDemote: true
  },
  hypothesis: {
    name: "Hypothesis",
    floor: 0.30,
    ceiling: 0.50,      // Hypotheses have a ceiling, not just a floor
    description: "Uncertain inference, hedged language",
    indicators: ["I think", "maybe", "probably", "might", "not sure", "I guess"],
    canPromote: true,
    canDemote: false    // Already lowest persistent tier
  },
  temporary_context: {
    name: "Temporary Context",
    floor: 0.40,
    description: "Session-bound information, not persistent",
    indicators: ["right now", "currently", "at the moment", "today"],
    canPromote: true,
    canDemote: false,
    expires: true       // Should be cleaned up after session
  }
};

/**
 * Classify the belief tier of extracted information
 * Uses linguistic cues and extraction context
 */
export function classifyTier(text, extractionContext = {}) {
  const lowerText = text.toLowerCase();
  
  // Check for hedging language first (hypothesis)
  const hedgePatterns = [
    /\bi think\b/i,
    /\bmaybe\b/i,
    /\bprobably\b/i,
    /\bmight\b/i,
    /\bnot sure\b/i,
    /\bi guess\b/i,
    /\bperhaps\b/i,
    /\bseems like\b/i
  ];
  
  for (const pattern of hedgePatterns) {
    if (pattern.test(lowerText)) {
      return { tier: "hypothesis", confidence: 0.45 };
    }
  }
  
  // Check for temporary context
  const temporaryPatterns = [
    /\bright now\b/i,
    /\bcurrently\b/i,
    /\bat the moment\b/i,
    /\btoday\b/i,
    /\bthis week\b/i,
    /\btemporarily\b/i
  ];
  
  for (const pattern of temporaryPatterns) {
    if (pattern.test(lowerText)) {
      return { tier: "temporary_context", confidence: 0.40 };
    }
  }
  
  // Check for explicit preferences
  const preferencePatterns = [
    /\bi (?:really )?(?:like|love|enjoy|prefer)\b/i,
    /\bi (?:hate|dislike|don't like|can't stand)\b/i,
    /\bmy favorite\b/i,
    /\bi'm (?:not )?a fan of\b/i
  ];
  
  for (const pattern of preferencePatterns) {
    if (pattern.test(lowerText)) {
      return { tier: "preference", confidence: 0.80 };
    }
  }
  
  // Check for direct assertions
  const assertionPatterns = [
    /\bi am\b/i,
    /\bmy name is\b/i,
    /\bi have\b/i,
    /\bi work (?:at|for|as)\b/i,
    /\bi live in\b/i,
    /\bi'm from\b/i,
    /\bi was born\b/i
  ];
  
  for (const pattern of assertionPatterns) {
    if (pattern.test(lowerText)) {
      return { tier: "asserted_fact", confidence: 0.92 };
    }
  }
  
  // Default to observed_fact
  return { tier: "observed_fact", confidence: 0.80 };
}

/**
 * Validate and enforce confidence floors/ceilings
 */
export function enforceConfidenceBounds(tier, confidence) {
  const tierDef = TIERS[tier];
  if (!tierDef) {
    return confidence;
  }
  
  // Enforce floor
  let bounded = Math.max(confidence, tierDef.floor);
  
  // Enforce ceiling if exists (for hypothesis tier)
  if (tierDef.ceiling) {
    bounded = Math.min(bounded, tierDef.ceiling);
  }
  
  return bounded;
}

/**
 * Determine if a tier can be promoted based on new evidence
 */
export function canPromoteTier(currentTier, evidence) {
  const tierDef = TIERS[currentTier];
  
  if (!tierDef || !tierDef.canPromote) {
    return { canPromote: false, reason: "Tier cannot be promoted" };
  }
  
  // Promotion rules
  const promotionPaths = {
    hypothesis: {
      nextTier: "observed_fact",
      requirement: "User confirmation or repeated consistent mention"
    },
    observed_fact: {
      nextTier: "asserted_fact", 
      requirement: "User explicitly confirms"
    },
    preference: {
      nextTier: "asserted_fact",
      requirement: "User emphatically confirms"
    },
    temporary_context: {
      nextTier: "observed_fact",
      requirement: "Persists across sessions"
    }
  };
  
  const path = promotionPaths[currentTier];
  if (path) {
    return {
      canPromote: true,
      nextTier: path.nextTier,
      requirement: path.requirement
    };
  }
  
  return { canPromote: false };
}

/**
 * Check if tier should be demoted (e.g., due to contradiction or uncertainty)
 */
export function shouldDemoteTier(currentTier, reason) {
  const tierDef = TIERS[currentTier];
  
  if (!tierDef || !tierDef.canDemote) {
    return { shouldDemote: false };
  }
  
  // Demotion triggers
  const demotionTriggers = [
    "contradiction_detected",
    "user_uncertainty",
    "conflicting_evidence",
    "temporal_change"
  ];
  
  if (demotionTriggers.includes(reason)) {
    const demotionPaths = {
      asserted_fact: "observed_fact",
      observed_fact: "hypothesis",
      preference: "hypothesis"
    };
    
    return {
      shouldDemote: true,
      newTier: demotionPaths[currentTier] || "hypothesis"
    };
  }
  
  return { shouldDemote: false };
}

/**
 * Get tier priority for conflict resolution
 * Higher number = higher priority
 */
export function getTierPriority(tier) {
  const priorities = {
    asserted_fact: 5,
    observed_fact: 4,
    preference: 3,
    hypothesis: 2,
    temporary_context: 1
  };
  
  return priorities[tier] || 0;
}

