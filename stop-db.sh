#!/bin/bash
# Stop MeaningMemory V3 Database

echo "🛑 Stopping MeaningMemory V3 Database..."

cd "$(dirname "$0")"

docker compose down

echo "✅ Database stopped"

