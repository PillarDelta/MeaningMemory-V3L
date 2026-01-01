#!/bin/bash

# Load environment variables from .env file
SCRIPT_DIR="$(dirname "$0")"
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

echo "🧠 Starting MeaningMemory V3-L Server..."
echo "   Local Memory LLM: Ollama/Phi-3"
echo "   Cloud Interaction: Grok"
echo ""

# Check if Ollama is running
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "✅ Ollama is running"
else
  echo "⚠️  Ollama not detected - starting..."
  brew services start ollama 2>/dev/null || echo "   Please start Ollama manually"
  sleep 2
fi

cd "$(dirname "$0")/server"
node src/index.js
