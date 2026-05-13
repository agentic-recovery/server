/**
 * models/Chat.js
 * Persists the full conversation history for each chat session.
 * System lifecycle messages are injected here when request status changes.
 */

const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: [4000, "Message content cannot exceed 4000 characters"],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    // For system messages: which lifecycle event triggered this
    event: {
      type: String,
      enum: ["accepted", "on_the_way", "completed", "cancelled", "matched", null],
      default: null,
    },
  },
  { _id: true }
);

const chatSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Linked user (null for anonymous guests)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Linked request — set once a booking is confirmed
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      default: null,
      index: true,
    },

    messages: [messageSchema],

    // Current conversation stage for context
    stage: {
      type: String,
      enum: ["collecting", "awaiting_confirmation", "confirmed", "cancelled"],
      default: "collecting",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

chatSchema.index({ sessionId: 1 });
chatSchema.index({ userId: 1 });
chatSchema.index({ requestId: 1 });

/**
 * Append a system lifecycle message to this chat.
 * @param {string} event  - lifecycle event key
 * @param {string} content - human-readable message
 */
chatSchema.methods.addSystemMessage = async function (event, content) {
  this.messages.push({ role: "system", content, event, timestamp: new Date() });
  return this.save();
};

module.exports = mongoose.model("Chat", chatSchema);
