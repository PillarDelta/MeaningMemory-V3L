# MeaningMemory V3-L

<div align="center">

![Version](https://img.shields.io/badge/version-3.0.0--L-blue)
![License](https://img.shields.io/badge/license-Proprietary-red)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)

**Hybrid Memory Architecture for Conversational AI**

*Local Memory LLM + Cloud Interaction LLM*

</div>

---

## 🎯 Overview

MeaningMemory V3-L is an intelligent memory system that gives AI assistants persistent, structured memory capabilities. Unlike traditional stateless chatbots, MeaningMemory understands and remembers:

- **Who you are** (name, identity)
- **What you like** (preferences, favorites)
- **What you've shared** (facts, context)
- **How confident it is** (belief tiering)

### Key Innovation: Hybrid Architecture

| Component | Technology | Cost |
|-----------|------------|------|
| **Response Generation** | Any OpenAI-compatible LLM* | API cost |
| **Memory Extraction** | Phi-3 (Local via Ollama) | **FREE** |
| **Embeddings** | BGE-small (Local) | **FREE** |
| **Vector Search** | PostgreSQL + pgvector | Self-hosted |

*\*This implementation uses **Grok (xAI)** as an example, but any OpenAI-compatible API works: OpenAI GPT-4, Anthropic Claude, Mistral, Groq, Together AI, or local models via Ollama.*

This hybrid approach reduces API costs by ~50% while keeping user-facing responses high-quality.

---

## ✨ Features

### Core Memory Capabilities

| Feature | Description |
|---------|-------------|
| **⚡ Instant Extraction** | Names & preferences stored instantly via pattern matching (no LLM wait) |
| **🧠 Deep Extraction** | Background LLM analysis for complex information |
| **🎯 Belief Tiering** | 5 confidence levels: asserted_fact, observed_fact, preference, hypothesis, temporary_context |
| **📉 Memory Decay** | Exponential decay with reinforcement on access |
| **⚔️ Contradiction Detection** | Automatic detection when user updates information |
| **🔗 Entity Resolution** | Canonicalizes entity mentions with aliases |
| **🕸️ Graph Relations** | Memory-to-memory links with spreading activation |
| **❤️ First-class Preferences** | Dedicated preference storage with valence (positive/negative) |

### UI Features

| Feature | Description |
|---------|-------------|
| **💬 Streaming Responses** | Real-time token streaming via SSE |
| **📊 Live Stats** | Knowledge base metrics in left sidebar |
| **📋 Context Feed** | Recent memories displayed in right sidebar |
| **🎨 Glass Morphism UI** | Modern, responsive design |
| **📱 Mobile Responsive** | Collapsible sidebars on all devices |
| **🗑️ Clear Session** | Reset UI without affecting database |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MeaningMemory V3-L Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Message: "My name is Costa, I love coffee"                │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ⚡ PHASE 0: INSTANT EXTRACTION (< 50ms)                  │    │
│  │ • Pattern matching for names: "Costa" → stored          │    │
│  │ • Pattern matching for preferences: "coffee" → stored   │    │
│  │ • No LLM needed - regex-based                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🔍 PHASE 1: RETRIEVAL                                    │    │
│  │ • Vector similarity search (BGE-small embeddings)       │    │
│  │ • Spreading activation through graph                    │    │
│  │ • Preference lookup                                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🌐 PHASE 2: RESPONSE (Grok Cloud)                        │    │
│  │ • Streaming response with memory context                │    │
│  │ • User sees response immediately                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼ (background, non-blocking)                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 💻 PHASE 3-4: DEEP EXTRACTION (Phi-3 Local)              │    │
│  │ • Structured memory extraction                          │    │
│  │ • Contradiction detection                               │    │
│  │ • Entity resolution                                     │    │
│  │ • Graph relation discovery                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Docker** (for PostgreSQL)
- **Ollama** (for local LLM)
- **xAI API Key** (for Grok responses)

### 1. Install Ollama & Pull Model

```bash
# macOS
brew install ollama
brew services start ollama

# Pull Phi-3 Mini (~2.3GB)
ollama pull phi3:mini
```

### 2. Clone & Configure

```bash
git clone https://github.com/PillarDelta/MeaningMemory-V3L.git
cd MeaningMemory-V3L

# Create environment file
cat > .env << EOF
PORT=3335
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/meaning_memory_v3l
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MEMORY_MODEL=phi3:mini
USE_LOCAL_MEMORY_LLM=true
XAI_API_KEY=your-xai-api-key-here
XAI_INTERACTION_MODEL=grok-3-fast
XAI_MEMORY_MODEL=grok-3-mini-fast
EOF
```

### 3. Start Services

```bash
# Make scripts executable
chmod +x start-db.sh stop-db.sh start-server.sh

# Start PostgreSQL (Docker)
./start-db.sh

# Install dependencies
cd server && npm install && cd ..

# Start server
./start-server.sh
```

### 4. Open Browser

Navigate to **http://localhost:3335**

---

## 📁 Project Structure

```
meaning-memory-v3-L/
├── client/
│   └── index.html          # Single-file frontend (HTML/CSS/JS)
├── server/
│   └── src/
│       ├── index.js            # Express server & API routes
│       ├── config.js           # Environment configuration
│       ├── llm.js              # Ollama & Grok clients
│       ├── memoryAgent.js      # Memory extraction (local/cloud)
│       ├── responseAgent.js    # Response generation (streaming)
│       ├── memoryStore.js      # Database operations
│       ├── embeddings.js       # BGE-small embeddings
│       ├── beliefTiering.js    # Confidence management
│       ├── contradictionDetector.js  # Conflict detection
│       ├── entityResolver.js   # Entity canonicalization
│       ├── graphRetrieval.js   # Spreading activation
│       ├── decayService.js     # Memory decay service
│       ├── prompts.js          # LLM prompts
│       └── schema.sql          # PostgreSQL schema
├── theory/
│   ├── meaning-memory-theoretical-basis_1.txt
│   └── MeaningMemory_Theory_vs_Implementation.md
├── docker-compose.yml      # PostgreSQL + pgvector
├── start-db.sh             # Database startup script
├── start-server.sh         # Server startup script
├── stop-db.sh              # Database shutdown script
└── README.md               # This file
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3335 | Server port |
| `DATABASE_URL` | localhost:5434 | PostgreSQL connection |
| `OLLAMA_BASE_URL` | localhost:11434 | Ollama API endpoint |
| `OLLAMA_MEMORY_MODEL` | phi3:mini | Local model for memory extraction |
| `USE_LOCAL_MEMORY_LLM` | true | Use local LLM (false = use Grok for memory) |
| `XAI_API_KEY` | (required) | xAI API key for Grok |
| `XAI_INTERACTION_MODEL` | grok-3-fast | Cloud model for responses |
| `XAI_MEMORY_MODEL` | grok-3-mini-fast | Fallback cloud model for memory |

### Belief Tier Configuration

| Tier | Confidence Floor | Use Case |
|------|------------------|----------|
| `asserted_fact` | 0.90 | User explicitly stated ("I am...", "My name is...") |
| `observed_fact` | 0.80 | Inferred from behavior |
| `preference` | 0.75 | Likes/dislikes ("I love...", "I hate...") |
| `hypothesis` | 0.50 | Uncertain inference ("maybe", "I think") |
| `temporary_context` | 0.40 | Session-bound ("right now", "today") |

### Using Alternative LLMs

The Interaction Agent (response generation) uses the OpenAI SDK, so any OpenAI-compatible API works:

**OpenAI:**
```env
XAI_BASE_URL=https://api.openai.com/v1
XAI_API_KEY=sk-your-openai-key
XAI_INTERACTION_MODEL=gpt-4o
```

**Anthropic (via proxy):**
```env
XAI_BASE_URL=https://api.anthropic.com/v1
XAI_API_KEY=sk-ant-your-key
XAI_INTERACTION_MODEL=claude-3-5-sonnet-20241022
```

**Groq (fast inference):**
```env
XAI_BASE_URL=https://api.groq.com/openai/v1
XAI_API_KEY=gsk_your-groq-key
XAI_INTERACTION_MODEL=llama-3.1-70b-versatile
```

**Local via Ollama:**
```env
XAI_BASE_URL=http://localhost:11434/v1
XAI_API_KEY=ollama
XAI_INTERACTION_MODEL=llama3.1:8b
```

> **Note:** To change the base URL, modify `XAI_BASE_URL` in `server/src/config.js`.

---

## 🗄️ Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `memory_units` | Main memory storage with embeddings |
| `preferences` | First-class preference storage |
| `entities` | Canonical entity registry |
| `memory_relations` | Graph edges between memories |
| `contradictions` | Detected conflicts for review |
| `decay_log` | Memory decay audit trail |

### Key Indexes

- **HNSW index** on embeddings for fast vector search
- **GIN index** for full-text search on summaries
- **B-tree indexes** on tier, importance, and active status

---

## 🔌 API Endpoints

### Chat

```http
POST /chat
Content-Type: application/json

{"message": "Hello, my name is Costa"}
```

Returns: Server-Sent Events (SSE) stream

### Memory Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/memories` | GET | List all active memories |
| `/memories?inactive=true` | GET | Include inactive memories |
| `/stats` | GET | Knowledge base statistics |
| `/preferences` | GET | List user preferences |
| `/entities` | GET | List resolved entities |
| `/contradictions` | GET | Pending contradictions |
| `/contradictions/:id/resolve` | POST | Resolve a contradiction |
| `/decay/run` | POST | Trigger manual decay update |

---

## 🧪 Testing the Memory System

### Test Sequence

1. **Identity Test**
   ```
   User: "My name is Costa"
   → Instant extraction: "User's name is Costa"
   
   User: "Who am I?"
   → Response uses memory: "You're Costa!"
   ```

2. **Preference Test**
   ```
   User: "I love rock music and hate country"
   → Instant extraction: +rock music, -country
   
   User: "What kind of music do I like?"
   → Response: "You like rock music"
   ```

3. **Contradiction Test**
   ```
   User: "My name is Costa"
   User: "Actually, my name is Alex"
   → Detects identity conflict, supersedes old memory
   ```

---

## 🔧 Troubleshooting

### Ollama not detected

```bash
# Check if running
curl http://localhost:11434/api/tags

# Start if needed
brew services start ollama
```

### Model not found

```bash
ollama pull phi3:mini
ollama list
```

### Slow memory extraction

Memory extraction runs in background, so users don't wait. For faster extraction:

```bash
ollama pull qwen2:1.5b
# Then set OLLAMA_MEMORY_MODEL=qwen2:1.5b in .env
```

### Database connection failed

```bash
# Check if container is running
docker ps | grep meaning-memory

# Restart database
./stop-db.sh
./start-db.sh
```

---

## 📊 Performance

### Memory Extraction Speed

| Model | Speed | Accuracy | Recommended |
|-------|-------|----------|-------------|
| phi3:mini | ~5-15 tok/s | Good | ✅ Default |
| qwen2:1.5b | ~15-25 tok/s | OK | Faster option |

### Instant Extraction

Pattern-based extraction (names, preferences) completes in **< 50ms**, ensuring users always have context on their next message.

---

## 🔐 Privacy

V3-L is designed with privacy in mind:

- **Memory extraction** runs locally (Phi-3 via Ollama)
- **Embeddings** computed locally (BGE-small)
- **Database** self-hosted (PostgreSQL)
- **Only responses** use cloud API (Grok)

Your conversation content stays on your machine for memory processing.

---

## 🗺️ Roadmap

- [ ] Multi-user support with separate memory spaces
- [ ] Memory export/import functionality
- [ ] Web-based memory management UI
- [ ] Support for additional local LLMs
- [ ] Memory clustering and summarization
- [ ] Temporal reasoning improvements

---

## 📄 License

© 2026 Pillar Delta PC. All rights reserved.

This software is proprietary and confidential.

---

## 🤝 Contributing

This is a private repository. For contribution guidelines, please contact the maintainers.

---

<div align="center">

**Built with ❤️ by Pillar Delta**

</div>
