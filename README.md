# Agentic AI Roadside Recovery System — Backend API

A production-ready Node.js/Express REST API that connects broken-down drivers with the nearest and best-value recovery truck provider using a three-phase **Agentic AI decision engine**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 18 |
| Framework | Express.js 4 |
| Database | MongoDB + Mongoose 8 |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Validation | express-validator |
| Security | helmet, cors, express-rate-limit |
| Logging | morgan |

---

## Project Structure

```
src/
├── app.js                    # Express app + server startup
├── config/
│   └── db.js                 # MongoDB connection
├── controllers/
│   ├── authController.js     # Register / login for providers and users
│   ├── providerController.js # Provider CRUD + availability management
│   └── requestController.js  # Breakdown requests + AI trigger
├── middleware/
│   ├── auth.js               # JWT authentication + role guards
│   ├── errorHandler.js       # Global error handler + 404
│   └── validate.js           # express-validator runner
├── models/
│   ├── User.js               # Driver / user schema
│   ├── Provider.js           # Recovery company schema (pricing, availability, etc.)
│   └── Request.js            # Breakdown request + scoring detail schema
├── routes/
│   ├── authRoutes.js         # /api/auth/*
│   ├── providerRoutes.js     # /api/providers/*
│   └── requestRoutes.js      # /api/requests/*
├── services/
│   ├── agentService.js       # 🤖 Agentic AI — Perceive → Evaluate → Act
│   ├── baselineService.js    # Baseline matcher (first-available, no scoring)
│   └── authService.js        # JWT sign / verify helpers
└── utils/
    ├── distance.js           # Haversine formula + service area check
    ├── pricing.js            # Price calculation (urgency, night, weekend)
    ├── response.js           # Standardised API response envelope
    └── seed.js               # Database seeder with test providers
```

---

## Getting Started

### 1. Clone and install

```bash
git clone <repo-url>
cd agentic-recovery-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/agentic_recovery
JWT_SECRET=change_this_to_a_long_random_string
JWT_EXPIRES_IN=7d
CORS_ORIGINS=http://localhost:3000
```

### 3. Seed the database

```bash
# Seed providers and test users
npm run seed

# Wipe all collections first, then seed
npm run seed -- --clear
```

### 4. Start the server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Server starts at `http://localhost:5000`

---

## API Reference

All responses follow this envelope:

```json
{
  "success": true | false,
  "message": "Human-readable message",
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

---

### Authentication — `/api/auth`

#### Register a provider
```http
POST /api/auth/provider/register
Content-Type: application/json

{
  "companyName": "Swift Recovery Ltd",
  "email": "swift@recovery.com",
  "password": "SecurePass123!",
  "contactNumber": "+44 7700 900001",
  "serviceArea": {
    "city": "Birmingham",
    "location": { "type": "Point", "coordinates": [-1.8904, 52.4862] },
    "radiusKm": 40
  },
  "vehicleTypes": ["Flatbed", "Wheel Lift"],
  "pricing": {
    "basePrice": 80,
    "minPrice": 60,
    "maxPrice": 250,
    "pricePerKm": 1.8
  },
  "negotiation": {
    "urgencyAdjustment": 20,
    "nightSurcharge": 15,
    "weekendPremium": 10,
    "autoNegotiation": true
  }
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "Provider registered successfully.",
  "data": {
    "token": "<JWT>",
    "provider": { "id": "...", "companyName": "Swift Recovery Ltd", ... }
  }
}
```

---

#### Login provider
```http
POST /api/auth/provider/login
Content-Type: application/json

{ "email": "swift@recovery.com", "password": "SecurePass123!" }
```

---

#### Register user
```http
POST /api/auth/user/register
Content-Type: application/json

{ "name": "Alice Driver", "email": "alice@example.com", "password": "SecurePass123!" }
```

---

#### Login user
```http
POST /api/auth/user/login
Content-Type: application/json

{ "email": "alice@example.com", "password": "SecurePass123!" }
```

---

#### Get current profile
```http
GET /api/auth/me
Authorization: Bearer <JWT>
```

---

### Providers — `/api/providers`

#### List all providers
```http
GET /api/providers?page=1&limit=20&city=Birmingham&vehicleType=Flatbed&available=true
```

#### Get single provider
```http
GET /api/providers/:id
```

#### Update provider profile
```http
PUT /api/providers/:id
Authorization: Bearer <provider-JWT>
Content-Type: application/json

{
  "pricing": { "basePrice": 85, "pricePerKm": 2.0 },
  "negotiation": { "urgencyAdjustment": 25, "autoNegotiation": true }
}
```

#### Toggle availability
```http
PATCH /api/providers/:id/availability
Authorization: Bearer <provider-JWT>
Content-Type: application/json

{
  "isAvailable": true,
  "emergencyMode": false,
  "workingDays": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "workingHours": { "start": "07:00", "end": "20:00" }
}
```

#### Get provider stats
```http
GET /api/providers/:id/stats
Authorization: Bearer <provider-JWT>
```

#### Deactivate account
```http
DELETE /api/providers/:id
Authorization: Bearer <provider-JWT>
```

---

### Requests (Breakdowns) — `/api/requests`

#### Submit breakdown + trigger Agentic AI
```http
POST /api/requests
Content-Type: application/json

{
  "userLocation": {
    "lat": 52.4862,
    "lng": -1.8904,
    "address": "A38 Northbound, Birmingham"
  },
  "vehicleType": "Car",
  "urgencyLevel": "high",
  "description": "Engine failure, stuck on hard shoulder",
  "preferredLanguage": "en",
  "method": "agentic"
}
```

> Pass `"method": "baseline"` to use the simple first-available matcher instead.
>
> Authentication is **optional** — anonymous requests are accepted.

**Response 201:**
```json
{
  "success": true,
  "message": "Agentic AI matched a provider.",
  "data": {
    "request": {
      "_id": "...",
      "status": "matched",
      "finalPrice": 127.50,
      "providerETA": 12,
      "selectedProvider": { "companyName": "Swift Recovery Ltd", ... }
    },
    "winner": {
      "provider": { ... },
      "distanceKm": 3.2,
      "calculatedPrice": 127.50,
      "priceBreakdown": {
        "basePrice": 80,
        "distanceCost": 5.76,
        "adjustments": { "urgency": "+20% (£17.15)" },
        "finalPrice": 127.50
      },
      "scores": {
        "distance": 0.92,
        "availability": 1.0,
        "price": 0.78,
        "total": 0.889
      }
    },
    "allScores": [
      { "companyName": "Swift Recovery Ltd", "totalScore": 0.889, "distanceKm": 3.2, "finalPrice": 127.50 },
      { "companyName": "Midland Rescue Services", "totalScore": 0.741, "distanceKm": 18.4, "finalPrice": 145.00 }
    ],
    "candidateCount": 4,
    "method": "agentic"
  }
}
```

#### Get all requests (authenticated)
```http
GET /api/requests?page=1&limit=20&status=matched
Authorization: Bearer <JWT>
```

Providers automatically see only their own matched jobs.

#### Get single request
```http
GET /api/requests/:id
Authorization: Bearer <JWT>
```

#### Update request status (provider)
```http
PATCH /api/requests/:id/status
Authorization: Bearer <provider-JWT>
Content-Type: application/json

{ "status": "accepted", "note": "En route, ETA 10 minutes" }
```

Valid status transitions: `matched → accepted → in_progress → completed`  
Provider can also `decline` or `cancel`.

---

## Agentic AI Engine

The engine (`services/agentService.js`) runs three phases on every `POST /api/requests`:

### Phase 1 — Perceive
Queries MongoDB for providers that:
- Are active and support the requested vehicle type
- Are available today (working day check) **or** have `emergencyMode: true`
- Cover the user's location within their `serviceArea.radiusKm`

### Phase 2 — Evaluate
Each candidate is scored on three weighted dimensions:

```
Score = (0.4 × distanceScore) + (0.3 × availabilityScore) + (0.3 × priceScore)
```

| Dimension | Logic |
|-----------|-------|
| **Distance** (0.4) | Normalised inverse — 0 km = 1.0, furthest = 0.0 |
| **Availability** (0.3) | 1.0 = available in hours, 0.7 = emergency only, 0.5 = outside hours |
| **Price** (0.3) | Normalised inverse — cheapest = 1.0, most expensive = 0.0 |

**Price negotiation** (applied before scoring):
```
price = basePrice + (distanceKm × pricePerKm)
      + urgency adjustment % (×1.5 for critical)
      + night surcharge % (if 22:00–06:00)
      + weekend premium % (if Sat/Sun)
      clamped to [minPrice, maxPrice]
```

### Phase 3 — Act
- Selects highest-scoring provider
- Saves `selectedProvider`, `finalPrice`, `scoringDetails[]`, `providerETA` to the request
- Increments provider's `stats.totalJobs`
- Returns full transparency data to the API caller

### Baseline Comparison
`POST /api/requests` with `"method": "baseline"` uses `baselineService.js`:
- Selects **first available** provider in the list
- No scoring, no negotiation — uses raw `basePrice`
- Use for A/B comparison against the agentic engine

---

## Security

| Measure | Implementation |
|---------|---------------|
| Password hashing | bcryptjs, salt rounds = 12 |
| JWT auth | 7-day expiry, Bearer token |
| Input validation | express-validator on all POST/PUT/PATCH |
| Rate limiting | 100 req/15 min global; 20 req/15 min on `/api/auth` |
| Security headers | helmet (CSP, HSTS, X-Frame-Options, etc.) |
| CORS | Configurable whitelist via `CORS_ORIGINS` env var |
| Soft deletes | Providers are deactivated, not dropped |
| Ownership checks | Providers can only modify their own records |

---

## Seeded Test Data

After `npm run seed`, six providers are available across the West Midlands:

| Company | City | Base Price | Emergency |
|---------|------|-----------|-----------|
| Swift Recovery Ltd | Birmingham | £80 | ✗ |
| Midland Rescue Services | Coventry | £95 | ✓ 24/7 |
| M6 Motorway Assist | Wolverhampton | £75 | ✗ |
| BudgetBreakdown UK | Leicester | £60 | ✗ (no AI) |
| HeavyHaul Pro | Nottingham | £150 | ✓ |
| NightOwl Recovery | Derby | £90 | ✓ (night specialist) |

All passwords: `Password123!`

---

## Frontend Integration

The backend is designed to work with the **Recovery Provider Dashboard** (Next.js frontend):

| Frontend action | Backend call |
|-----------------|-------------|
| Provider registers | `POST /api/auth/provider/register` |
| Provider logs in | `POST /api/auth/provider/login` |
| Dashboard loads | `GET /api/auth/me` + `GET /api/providers/:id/stats` |
| Update pricing | `PUT /api/providers/:id` |
| Toggle online | `PATCH /api/providers/:id/availability` |
| View job inbox | `GET /api/requests?status=matched` |
| Accept/decline job | `PATCH /api/requests/:id/status` |
| Driver submits request | `POST /api/requests` |
