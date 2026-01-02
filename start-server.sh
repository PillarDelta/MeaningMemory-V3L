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

# Path to the LLM-V1 absorption daemon
LLM_V1_DIR="$SCRIPT_DIR/../meaning-memory-llm-v1"
DAEMON_LOG="$LLM_V1_DIR/logs/daemon.log"

# Start the absorption daemon in the background (if Python environment exists)
if [ -d "$LLM_V1_DIR" ]; then
  echo ""
  echo "🔄 Starting Absorption Daemon..."
  
  # Create logs directory if it doesn't exist
  mkdir -p "$LLM_V1_DIR/logs"
  
  # Check if venv exists, if not suggest creating one
  if [ -d "$LLM_V1_DIR/venv" ]; then
    # Activate venv and start daemon
    (
      cd "$LLM_V1_DIR"
      source venv/bin/activate
      python scripts/daemon.py >> "$DAEMON_LOG" 2>&1 &
      echo $! > "$LLM_V1_DIR/.daemon.pid"
    )
    echo "✅ Absorption daemon started (PID: $(cat $LLM_V1_DIR/.daemon.pid 2>/dev/null || echo 'unknown'))"
    echo "   Log: $DAEMON_LOG"
  else
    echo "⚠️  Python venv not found at $LLM_V1_DIR/venv"
    echo "   To enable absorption daemon:"
    echo "   cd $LLM_V1_DIR && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  fi
  echo ""
fi

cd "$(dirname "$0")/server"
node src/index.js
