#!/bin/bash

echo "🗄️  Starting MeaningMemory V3-L Database..."
echo "   Port: 5434"
echo ""

docker compose up -d

echo ""
echo "Waiting for database to be ready..."
sleep 3

# Check if healthy
if docker compose ps | grep -q "healthy"; then
  echo "✅ Database ready on port 5434"
else
  echo "⏳ Database starting... (may take a few more seconds)"
fi
