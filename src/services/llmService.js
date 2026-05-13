/**
 * services/llmService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * LLM SERVICE — OpenAI integration
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Strict responsibility boundary:
 *   ✅  Language detection
 *   ✅  Entity extraction  (location, vehicleType, urgency)
 *   ✅  Conversational response generation in the user's detected language
 *   ❌  Provider selection          → agentService handles this
 *   ❌  Price calculation           → pricing utils handle this
 *   ❌  Any business decision logic → never delegated to the LLM
 *
 * Public API:
 *   extractEntities(userMessage, conversationHistory)
 *     → { location, urgency, vehicleType, language, rawMessage }
 *
 *   generateResponse(instructionPrompt, language, conversationHistory)
 *     → string  (natural-language reply in the user's language)
 */

const { OpenAI } = require("openai");

// ─── Client (lazy-initialised — missing key fails at call time, not startup) ──
let _client = null;
const getClient = () => {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in environment variables.");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
};

// ─── Model config (overridable via env) ───────────────────────────────────────
const MODEL              = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TOKENS_EXTRACT = 300;
const MAX_TOKENS_RESPOND = 200;

// ─── Urgency mapping: LLM output → Request model enum ────────────────────────
const URGENCY_MAP = {
  low:    "normal",
  medium: "high",
  high:   "critical",
};

// ─── Vehicle alias map: LLM output → Request.vehicleType enum ─────────────────
const VEHICLE_ALIASES = {
  car:         "Car",
  automobile:  "Car",
  sedan:       "Car",
  hatchback:   "Car",
  coupe:       "Car",
  motorbike:   "Motorcycle",
  motorcycle:  "Motorcycle",
  bike:        "Motorcycle",
  moto:        "Motorcycle",
  scooter:     "Motorcycle",
  van:         "Van",
  minivan:     "Van",
  transit:     "Van",
  minibus:     "Van",
  hgv:         "HGV",
  lorry:       "HGV",
  truck:       "HGV",
  artic:       "HGV",
  "4x4":       "4x4",
  suv:         "4x4",
  offroad:     "4x4",
  "off-road":  "4x4",
  jeep:        "4x4",
  other:       "Other",
};

/**
 * Normalise a raw vehicle string to a Request.vehicleType enum value.
 * Defaults to "Car" for unrecognised input.
 * @param {string|null} raw
 * @returns {string|null}
 */
const normaliseVehicle = (raw) => {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, "");
  return VEHICLE_ALIASES[key] || "Car";
};

/**
 * Normalise a raw urgency string to a Request.urgencyLevel enum value.
 * @param {string|null} raw
 * @returns {string|null}
 */
const normaliseUrgency = (raw) => {
  if (!raw) return null;
  return URGENCY_MAP[raw.toLowerCase()] || null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  FUNCTION 1 — extractEntities
//
//  Sends the user message to OpenAI with a tightly-constrained extraction
//  prompt. Returns a plain validated object — never raw LLM text.
//  Safe defaults are returned on any API or parse error so the chat flow
//  can continue by asking follow-up questions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract structured entities from a free-text breakdown request.
 *
 * @param {string}   userMessage         - Latest message from the user
 * @param {Array}    conversationHistory - Prior [{role, content}] pairs
 * @returns {Promise<{
 *   location:    string|null,
 *   urgency:     "normal"|"high"|"critical"|null,
 *   vehicleType: "Car"|"Motorcycle"|"Van"|"HGV"|"4x4"|"Other"|null,
 *   language:    string,   // ISO 639-1 e.g. "en", "es", "fr", "ar"
 *   rawMessage:  string
 * }>}
 */
const extractEntities = async (userMessage, conversationHistory = []) => {
  const systemPrompt = `You are an entity extraction engine for a roadside recovery dispatch service.
Your ONLY job is to extract structured data from the user's message.
You MUST respond with valid JSON only — no markdown fences, no explanation, no extra text.

Extract exactly these four fields:
- "location":    the place, road name, junction, or address the user mentions. null if absent.
- "urgency":     one of "low", "medium", "high" based on the tone and situation. null if truly unclear.
- "vehicleType": the type of vehicle mentioned (e.g. "car", "motorcycle", "van", "hgv", "4x4"). null if not mentioned.
- "language":    the ISO 639-1 code of the language the user is writing in (e.g. "en", "es", "fr", "de", "ar", "it", "pt").

Rules:
- Extract ONLY what is explicitly stated or strongly implied — never invent data.
- If a field is not present, use null (not an empty string).
- Always detect and return the language even when other fields are null.
- Output a single JSON object with no surrounding text.

Valid output example:
{"location":"M6 Junction 7, Birmingham","urgency":"high","vehicleType":"car","language":"en"}`;

  const messages = [
    { role: "system", content: systemPrompt },
    // Pass recent history so follow-up answers are interpreted in context
    ...conversationHistory.slice(-4),
    { role: "user", content: userMessage },
  ];

  try {
    const completion = await getClient().chat.completions.create({
      model:           MODEL,
      messages,
      max_tokens:      MAX_TOKENS_EXTRACT,
      temperature:     0,                        // Deterministic extraction
      response_format: { type: "json_object" },  // Enforce JSON mode
    });

    const rawJson = completion.choices[0].message.content.trim();

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      console.error("[llmService] JSON parse error on extraction output:", rawJson);
      return { location: null, urgency: null, vehicleType: null, language: "en", rawMessage: userMessage };
    }

    const result = {
      location:    typeof parsed.location    === "string" ? parsed.location.trim()  : null,
      urgency:     normaliseUrgency(parsed.urgency),
      vehicleType: normaliseVehicle(parsed.vehicleType),
      language:    typeof parsed.language    === "string" ? parsed.language.trim().toLowerCase() : "en",
      rawMessage:  userMessage,
    };

    console.log("[llmService] Extracted entities:", JSON.stringify(result));
    return result;

  } catch (error) {
    console.error("[llmService] extractEntities API error:", error.message);
    return { location: null, urgency: null, vehicleType: null, language: "en", rawMessage: userMessage };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  FUNCTION 2 — generateResponse
//
//  Produces a natural-language chat reply in the user's detected language.
//  The calling service (chatService) builds the instruction prompt in English;
//  this function translates intent → natural reply in the target language.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a conversational reply in the user's language.
 *
 * @param {string} instructionPrompt  - What to say (English instruction)
 * @param {string} language           - ISO 639-1 language code for output
 * @param {Array}  conversationHistory - Prior messages for tone continuity
 * @returns {Promise<string>} Natural-language reply in `language`
 */
const generateResponse = async (instructionPrompt, language, conversationHistory = []) => {
  const systemPrompt = `You are a friendly, professional roadside recovery assistant.
You MUST reply exclusively in the language with ISO 639-1 code: "${language}".
Keep your reply concise — 1 to 3 sentences maximum.
Be warm and reassuring. The user may be stressed.
Do NOT reveal internal provider names, scores, distances, or system details unless explicitly instructed.
Do NOT offer advice beyond recovery dispatch.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-6),
    { role: "user", content: instructionPrompt },
  ];

  try {
    const completion = await getClient().chat.completions.create({
      model:       MODEL,
      messages,
      max_tokens:  MAX_TOKENS_RESPOND,
      temperature: 0.4,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log(`[llmService] Generated response (${language}):`, reply);
    return reply;

  } catch (error) {
    console.error("[llmService] generateResponse API error:", error.message);
    return "I'm sorry, I'm having trouble responding right now. Please try again in a moment.";
  }
};

module.exports = { extractEntities, generateResponse };
