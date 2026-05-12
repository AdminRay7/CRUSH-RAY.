const mongoose = require('mongoose');

// Session Schema - Store bot authentication
const SessionSchema = new mongoose.Schema({
    sessionId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    number: {
        type: String,
        sparse: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'banned'],
        default: 'active'
    },
    creds: {
        type: Object,
        default: {}
    },
    pairedAt: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastSeen: {
        type: Date,
        default: Date.now
    }
});

// Bot Settings Schema - Store per-bot configuration
const BotSettingsSchema = new mongoose.Schema({
    botNumber: {
        type: String,
        required: true,
        unique: true
    },
    settings: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    groupSettings: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: new Map()
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// User Data Schema - Store user warnings, activities
const UserDataSchema = new mongoose.Schema({
    jid: {
        type: String,
        required: true
    },
    botNumber: {
        type: String,
        required: true
    },
    warnings: {
        type: Map,
        of: Number,
        default: new Map()
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    messageCount: {
        type: Number,
        default: 0
    },
    isBanned: {
        type: Boolean,
        default: false
    },
    banReason: String,
    bannedAt: Date
});

// Create compound index for UserData
UserDataSchema.index({ jid: 1, botNumber: 1 }, { unique: true });

// Group Data Schema - Store group-specific settings
const GroupDataSchema = new mongoose.Schema({
    groupJid: {
        type: String,
        required: true
    },
    botNumber: {
        type: String,
        required: true
    },
    settings: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    welcomeMessage: String,
    goodbyeMessage: String,
    activeMembers: {
        type: Map,
        of: Date,
        default: new Map()
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create compound index for GroupData
GroupDataSchema.index({ groupJid: 1, botNumber: 1 }, { unique: true });

// Middleware to update timestamps
BotSettingsSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

SessionSchema.pre('save', function(next) {
    this.lastSeen = new Date();
    next();
});

// Models
const Session = mongoose.model('Session', SessionSchema);
const BotSettings = mongoose.model('BotSettings', BotSettingsSchema);
const UserData = mongoose.model('UserData', UserDataSchema);
const GroupData = mongoose.model('GroupData', GroupDataSchema);

module.exports = {
    Session,
    BotSettings,
    UserData,
    GroupData
};
