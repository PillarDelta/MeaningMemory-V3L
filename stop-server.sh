#!/bin/bash
# Stop MeaningMemory V3-L Server and Absorption Daemon

SCRIPT_DIR="$(dirname "$0")"
LLM_V1_DIR="$SCRIPT_DIR/../meaning-memory-llm-v1"

echo "🛑 Stopping MeaningMemory V3-L..."

# Stop the absorption daemon
if [ -f "$LLM_V1_DIR/.daemon.pid" ]; then
  DAEMON_PID=$(cat "$LLM_V1_DIR/.daemon.pid")
  if kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "   Stopping absorption daemon (PID: $DAEMON_PID)..."
    kill "$DAEMON_PID"
    sleep 1
    # Force kill if still running
    if kill -0 "$DAEMON_PID" 2>/dev/null; then
      kill -9 "$DAEMON_PID"
    fi
    echo "✅ Absorption daemon stopped"
  fi
  rm -f "$LLM_V1_DIR/.daemon.pid"
else
  echo "   No daemon PID file found"
fi

# Stop any Node.js processes running on port 3335
NODE_PID=$(lsof -ti:3335 2>/dev/null)
if [ -n "$NODE_PID" ]; then
  echo "   Stopping Node.js server (PID: $NODE_PID)..."
  kill "$NODE_PID" 2>/dev/null
  sleep 1
  # Force kill if still running
  if kill -0 "$NODE_PID" 2>/dev/null; then
    kill -9 "$NODE_PID"
  fi
  echo "✅ Node.js server stopped"
else
  echo "   No server running on port 3335"
fi

echo ""
echo "✅ MeaningMemory V3-L stopped"
echo "   Note: Database may still be running. Use ./stop-db.sh to stop it."




