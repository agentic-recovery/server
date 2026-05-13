# Chat Extension — Multilingual Conversational AI

> Extension to the Agentic AI Roadside Recovery System backend.
> Adds a full multi-turn chat interface powered by OpenAI + the existing Agentic AI engine.

---

## What was added

| File | Type | Purpose |
|------|------|---------|
| `src/services/llmService.js` | **New** | OpenAI entity extraction + multilingual response generation |
| `src/services/chatService.js` | **New** | Conversation state machine — collects fields, triggers AI, confirms booking |
| `src/controllers/chatController.js` | **New** | HTTP layer — validates input, delegates to chatService |
| `src/routes/chatRoutes.js` | **New** | Mounts `POST /api/chat` and utility endpoints |
| `src/app.js` | **+4 lines** | `require(chatRoutes)` + `app.use("/api/chat", chatRoutes)` |
| `package.json` | **+2 deps** | `openai`, `uuid` |
| `.env.example` | **+3 lines** | `OPENAI_API_KEY`, `OPENAI_MODEL` |

**18 existing files are completely unchanged.**

---

## Setup

```bash
# 1. Add to your .env file:
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini        # optional — this is the default

# 2. Install new dependencies:
npm install

# 3. Start the server (no other changes needed):
npm run dev
```

---

## API Endpoints

### `POST /api/chat`
Main conversational endpoint. Send one message per request; echo the returned `sessionId` on every subsequent turn to maintain conversation state.

**Authentication:** Optional. Include a `Bearer` token to link the final booking to a user account. Anonymous requests are fully supported.

**Request body:**
```json
{
  "message": "My car broke down on the M6 near junction 7",
  "sessionId": "optional-uuid-from-previous-response"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "sessionId": "3f4a1b2c-...",
    "message":   "I found a recovery provider 3.2 km away. Estimated price: £127. Shall I confirm the booking?",
    "stage":     "awaiting_confirmation",
    "data": {
      "provider":  { "companyName": "Swift Recovery Ltd", "contactNumber": "+44 7700 900001" },
      "price":     127,
      "eta":       8
    }
  }
}
```

| `stage` value | Meaning |
|---------------|---------|
| `collecting` | Still gathering location / vehicleType / urgency |
| `awaiting_confirmation` | Provider matched, offer presented, waiting for yes/no |
| `confirmed` | Booking created in database — terminal |
| `cancelled` | User declined — terminal |

---

### `DELETE /api/chat/:sessionId`
Reset a session and start a new conversation.

### `GET /api/chat/:sessionId/state`
Return a read-only snapshot of the session state (for debugging and evaluation).

```json
{
  "stage":       "collecting",
  "language":    "en",
  "location":    "M6 Junction 7",
  "vehicleType": "Car",
  "urgency":     null,
  "turnCount":   2,
  "lastActivity": "2025-01-15T14:32:10.000Z"
}
```

---

## Full Conversation Examples

### English — happy path

```
POST /api/chat  { "message": "I need a tow truck" }
→ "Of course! What is your location or the road you're on?"

POST /api/chat  { "message": "M6 Junction 7, Birmingham", "sessionId": "..." }
→ "Got it. How urgent is your situation? Are you in a safe place?"

POST /api/chat  { "message": "It's an emergency, I'm on the hard shoulder", "sessionId": "..." }
→ "I found a recovery provider 3.2 km away. Estimated price: £127. Estimated arrival: 8 minutes. Would you like to confirm?"

POST /api/chat  { "message": "Yes please", "sessionId": "..." }
→ "Your recovery service is booked! Reference: A3F92B1C. Help is on the way — please stay safe."
```

**Response contains:**
```json
{
  "stage": "confirmed",
  "data": {
    "requestId": "668f...",
    "provider":  { "companyName": "Swift Recovery Ltd" },
    "price":     127,
    "eta":       8
  }
}
```

---

### Spanish — automatic language detection

```
POST /api/chat  { "message": "Necesito una grúa, mi coche está averiado" }
→ "¡Claro! ¿Cuál es tu ubicación o el nombre de la carretera?"

POST /api/chat  { "message": "Estoy en la A38, cerca de Birmingham", "sessionId": "..." }
→ "Entendido. ¿Qué tan urgente es tu situación?"

POST /api/chat  { "message": "Es urgente", "sessionId": "..." }
→ "Encontré un proveedor a 3.2 km de distancia. Precio estimado: £127. ¿Deseas confirmar la reserva?"

POST /api/chat  { "message": "Sí", "sessionId": "..." }
→ "¡Tu servicio de recuperación está reservado! Referencia: B7C43A1F. La ayuda está en camino."
```

No configuration required — language is detected on every turn and persisted in session state.

---

## Architecture & Responsibility Separation

```
POST /api/chat
       │
       ▼
chatController.js          — HTTP only: validates input, reads sessionId
       │
       ▼
chatService.js             — ORCHESTRATION (this is where logic lives)
   │         │
   ▼         ▼
llmService  agentService
   │         │
   │         ├── perceive()   — fetch eligible providers from MongoDB
   │         └── evaluate()   — score & rank using weighted formula
   │
   ├── extractEntities()      — OpenAI: extract location/urgency/vehicleType/language
   └── generateResponse()     — OpenAI: generate reply in detected language
```

### What the LLM does
| Task | Done by |
|------|---------|
| Detect user language | ✅ `llmService.extractEntities` |
| Extract location from free text | ✅ `llmService.extractEntities` |
| Extract vehicle type | ✅ `llmService.extractEntities` |
| Detect urgency level | ✅ `llmService.extractEntities` |
| Generate chat reply in user's language | ✅ `llmService.generateResponse` |
| Select a provider | ❌ `agentService` only |
| Calculate or negotiate price | ❌ `utils/pricing` only |
| Make any booking decision | ❌ `chatService` only |

---

## Session State Machine

```
                    ┌─────────────────┐
    new session ──► │   collecting    │ ◄─── reset
                    └────────┬────────┘
                             │ all 3 fields present
                             ▼
                    ┌─────────────────┐
                    │awaiting_confirm │
                    └────────┬────────┘
                    yes ─────┤───── no
                    ▼        │         ▼
             ┌───────────┐   │  ┌───────────┐
             │ confirmed │   │  │ cancelled │
             └───────────┘   │  └───────────┘
                  (DB write) │
```

Sessions auto-expire after **30 minutes** of inactivity and are cleaned up on the next request from any client.

---

## Evaluation Logs

Every request emits structured console logs for project evaluation:

```
[llmService]  Extracted entities: {"location":"M6 J7","urgency":"critical","vehicleType":"Car","language":"en"}
[chatService] Session state after extraction: { sessionId: "...", location: "M6 J7", ... }
[chatService] Agent PERCEIVE: 4 candidate provider(s) found
[chatService] Agent EVALUATE — provider scores:
  1. Swift Recovery Ltd            score=0.889 dist=3.2km price=£127
  2. Midland Rescue Services        score=0.741 dist=18.4km price=£145
  3. M6 Motorway Assist             score=0.698 dist=22.1km price=£112
  4. NightOwl Recovery              score=0.612 dist=31.0km price=£138
[chatService] Agent SELECTED: Swift Recovery Ltd | price=£127 | score=0.889
[chatService] BOOKING CONFIRMED: { requestId: "...", provider: "Swift Recovery Ltd", finalPrice: "£127", ... }
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| OpenAI API down | Safe defaults returned; chat continues asking follow-up questions |
| No providers in area | Session resets to `collecting`; user asked to try a different location |
| User sends ambiguous yes/no | Re-prompts with offer details |
| Session expired (30 min) | New session created transparently on next message |
| Invalid `message` body | 422 Unprocessable Entity with field-level error detail |

---

## Production Notes

1. **Geocoding** — `chatService.geocodeLocation()` uses a deterministic hash stub. Replace it with a real geocoding call (Google Maps Geocoding API, Nominatim) before going live.

2. **Session storage** — The in-memory `Map` is fine for a single-process server. For multi-instance deployments (load balancers, PM2 cluster mode) replace with Redis using `ioredis`:
   ```js
   // Drop-in replacement for the sessions Map
   const redis = new Redis(process.env.REDIS_URL);
   await redis.set(`session:${id}`, JSON.stringify(session), "EX", 1800);
   const session = JSON.parse(await redis.get(`session:${id}`));
   ```

3. **Rate limiting** — The existing global limiter (100 req/15 min) covers `/api/chat`. Consider a tighter per-session limit for the chat endpoint.

4. **Cost control** — Each full conversation uses ~3–5 OpenAI API calls (1 extraction + 1 response per turn). At `gpt-4o-mini` pricing this is approximately $0.001–$0.003 per conversation.
