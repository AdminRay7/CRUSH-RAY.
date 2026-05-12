const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');

// ==================== LOAD CONFIG ====================
let config = {};
try { config = require('./config'); } catch { config = {}; }

config.ownerNumber = (config.ownerNumber || [])
    .map(num => num.replace(/[^0-9]/g, ''))
    .filter(num => num.length >= 10);

// ==================== DEFAULT SETTINGS ====================
const DEFAULT_SETTINGS = {
    mode: 'public',
    prefix: '.',
    maxCoOwners: 2,
    botName: 'INSIDIOUS: THE LAST KEY',
    developer: 'Stanley Assanaly',
    developerNumber: '255787069580',
    version: '2.1.1',
    year: 2025,
    updated: 2026,
    specialThanks: 'REDTECH',
    botImage: 'https://files.catbox.moe/mfngio.png',
    aliveImage: 'https://files.catbox.moe/mfngio.png',
    newsletterJid: '120363404317544295@newsletter',
    newsletterLink: 'https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p',
    requiredGroupJid: '',
    requiredGroupInvite: '',
    autoFollowChannels: [],

    // ========== ANTI FEATURES ==========
    antilink: true,
    antiporn: true,
    antiscam: true,
    antimedia: true,
    antitag: true,
    antiviewonce: true,
    antidelete: true,
    sleepingmode: false,
    antispam: true,
    anticall: true,
    antistatusmention: true,
    antifake: true,
    antipromote: true,
    antiurl: true,

    // ========== AUTO FEATURES ==========
    autoRead: true,
    autoReact: true,
    autoTyping: false,
    autoRecording: false,
    autoBio: true,
    autostatus: true,
    downloadStatus: false,
    autoSaveContact: true,
    autoDeleteMessages: false,
    autoReply: false,

    // ========== GROUP MANAGEMENT ==========
    welcomeGoodbye: true,
    activemembers: false,
    autoblockCountry: false,
    lockGroupSettings: false,

    // ========== AI ==========
    chatbot: true,

    // ========== THRESHOLDS & LIMITS ==========
    warnLimit: 3,
    maxTags: 5,
    inactiveDays: 7,
    antiSpamLimit: 5,
    antiSpamInterval: 10000,
    sleepingStart: '23:00',
    sleepingEnd: '06:00',
    maxMessagesPerMinute: 20,

    // ========== KEYWORDS ==========
    scamKeywords: ['win', 'prize', 'lottery', 'congratulations', 'million', 'inheritance', 'selected', 'claim', 'urgent', 'verify account'],
    pornKeywords: ['xxx', 'porn', 'sex', 'nude', 'adult', '18+', 'onlyfans', 'cam', 'escort'],
    fakeNumberPrefixes: ['120', '121', '122', '123', '999', '000'],
    blockedMediaTypes: ['photo', 'video'],
    blockedCountries: [],
    blockedUrlShorteners: ['bit.ly', 'tinyurl', 'short.link', 'cutt.ly', 'ow.ly'],

    // ========== AUTO REACT / STATUS ==========
    autoReactEmojis: ['❤️', '🔥', '👍', '🎉', '👏', '⚡', '✨', '🌟', '💎', '🛡️'],
    autoStatusActions: ['view', 'react'],
    statusReplyLimit: 50,

    // ========== SCOPES ==========
    autoReadScope: 'all',
    autoReactScope: 'all',
    chatbotScope: 'all',
    antiviewonceScope: 'all',
    antideleteScope: 'all',

    // ========== SECURITY ==========
    enableRateLimit: true,
    rateLimitWindow: 60000,
    rateLimitMax: 30,
    enableIpBlock: false,
    blockedIps: [],

    // ========== API ==========
    quoteApiUrl: 'https://api.quotable.io/random',
    aiApiUrl: 'https://text.pollinations.ai/',
    pornFilterApiKey: '',
};

// ==================== MONGODB MODELS ====================
const { Session, BotSettings, UserData, GroupData } = require('./database/models');

// ==================== PER‑BOT SETTINGS CACHE ====================
const botSettingsCache = new Map();

async function loadBotSettings(botNumber) {
    try {
        let settings = await BotSettings.findOne({ botNumber });
        if (!settings) {
            settings = new BotSettings({ 
                botNumber, 
                settings: DEFAULT_SETTINGS 
            });
            await settings.save();
        }
        botSettingsCache.set(botNumber, settings.settings);
        return settings.settings;
    } catch (err) {
        console.error(`[${botNumber}] Error loading settings:`, err);
        return DEFAULT_SETTINGS;
    }
}

async function saveBotSettings(botNumber, newSettings) {
    try {
        await BotSettings.findOneAndUpdate(
            { botNumber },
            { settings: newSettings, updatedAt: new Date() },
            { upsert: true }
        );
        botSettingsCache.set(botNumber, newSettings);
    } catch (err) {
        console.error(`[${botNumber}] Error saving settings:`, err);
    }
}

function getBotSetting(botNumber, key) {
    const settings = botSettingsCache.get(botNumber);
    return settings && settings[key] !== undefined ? settings[key] : DEFAULT_SETTINGS[key];
}

// ==================== PER‑BOT GROUP SETTINGS ====================
async function getGroupSetting(botNumber, groupJid, key) {
    try {
        let groupData = await GroupData.findOne({ groupJid, botNumber });
        if (!groupData) return getBotSetting(botNumber, key);
        return groupData.settings[key] !== undefined ? groupData.settings[key] : getBotSetting(botNumber, key);
    } catch (err) {
        return getBotSetting(botNumber, key);
    }
}

async function setGroupSetting(botNumber, groupJid, key, value) {
    try {
        let groupData = await GroupData.findOne({ groupJid, botNumber });
        if (!groupData) {
            groupData = new GroupData({ groupJid, botNumber, settings: {} });
        }
        groupData.settings[key] = value;
        await groupData.save();
        return true;
    } catch (err) {
        console.error(`[${botNumber}] Error saving group setting:`, err);
        return false;
    }
}

// ==================== PAIRING / SESSION SYSTEM ====================
let botSecretId = null;

function generateBotId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'INS';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

async function loadBotId() {
    const botSession = await Session.findOne({ sessionId: 'BOT_MASTER' });
    if (botSession && botSession.creds && botSession.creds.botId) {
        botSecretId = botSession.creds.botId;
    } else {
        botSecretId = generateBotId();
        await Session.updateOne(
            { sessionId: 'BOT_MASTER' },
            { $set: { creds: { botId: botSecretId } } },
            { upsert: true }
        );
    }
    return botSecretId;
}

// ==================== OWNERSHIP CHECKS ====================
function isGlobalAdmin(number) {
    const clean = number.replace(/[^0-9]/g, '');
    return config.ownerNumber.includes(clean);
}

function isBotOwner(botNumber, senderNumber) {
    return senderNumber === botNumber;
}

// ==================== PER‑BOT STORAGE ====================
const messageStore = new Map();
const warningTracker = new Map();
const spamTracker = new Map();
const inactiveTracker = new Map();
const statusCache = new Map();
const rateLimitStore = new Map();

// ==================== HELPER FUNCTIONS ====================
function fancy(text) {
    if (!text || typeof text !== 'string') return text;
    const map = {
        a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
        j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
        s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
        A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ',
        J: 'ᴊ', K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ',
        S: 'ꜱ', T: 'ᴛ', U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ'
    };
    return text.split('').map(c => map[c] || c).join('');
}

function getUsername(jid) { 
    return jid?.split('@')[0] || 'Unknown'; 
}

async function getContactName(conn, jid) {
    try {
        const contact = await conn.getContact(jid);
        return contact?.name || contact?.pushname || getUsername(jid);
    } catch { 
        return getUsername(jid); 
    }
}

async function getGroupName(conn, groupJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        return meta.subject || 'Group';
    } catch { 
        return 'Group'; 
    }
}

async function isBotAdmin(conn, groupJid) {
    try {
        if (!conn.user?.id) return false;
        const meta = await conn.groupMetadata(groupJid);
        return meta.participants.some(p => p.id === conn.user.id && (p.admin === 'admin' || p.admin === 'superadmin'));
    } catch { 
        return false; 
    }
}

async function isParticipantAdmin(conn, groupJid, participantJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        const participant = meta.participants.find(p => p.id === participantJid);
        return participant ? (participant.admin === 'admin' || participant.admin === 'superadmin') : false;
    } catch { 
        return false; 
    }
}

function enhanceMessage(conn, msg) {
    if (!msg) return msg;
    if (!msg.reply) {
        msg.reply = async (text, options = {}) => {
            try {
                return await conn.sendMessage(msg.key.remoteJid, { text, ...options }, { quoted: msg });
            } catch (e) { 
                return null; 
            }
        };
    }
    return msg;
}

// ==================== RATE LIMITING ====================
function checkRateLimit(botNumber, userId) {
    if (!getBotSetting(botNumber, 'enableRateLimit')) return { allowed: true };
    
    const now = Date.now();
    const window = getBotSetting(botNumber, 'rateLimitWindow');
    const max = getBotSetting(botNumber, 'rateLimitMax');
    
    let botStore = rateLimitStore.get(botNumber);
    if (!botStore) {
        botStore = new Map();
        rateLimitStore.set(botNumber, botStore);
    }
    
    let record = botStore.get(userId);
    if (!record || now - record.windowStart > window) {
        record = { count: 1, windowStart: now };
    } else {
        record.count++;
    }
    botStore.set(userId, record);
    
    return { allowed: record.count <= max, remaining: max - record.count };
}

// ==================== MESSAGE EXTRACTOR ====================
function extractMessageText(msg) {
    try {
        if (!msg.message) return '';
        const type = Object.keys(msg.message)[0];
        let body = '';

        if (type === 'conversation') body = msg.message.conversation || '';
        else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text || '';
        else if (type === 'buttonsResponseMessage') body = msg.message.buttonsResponseMessage.selectedButtonId || '';
        else if (type === 'templateButtonReplyMessage') body = msg.message.templateButtonReplyMessage.selectedId || '';
        else if (type === 'imageMessage') body = msg.message.imageMessage.caption || '';
        else if (type === 'videoMessage') body = msg.message.videoMessage.caption || '';
        else if (type === 'viewOnceMessage') {
            const subMsg = msg.message.viewOnceMessage.message;
            if (subMsg) return extractMessageText({ message: subMsg });
        }
        return body.trim();
    } catch (e) {
        return '';
    }
}

// ==================== ANTI FEATURES ====================
async function handleAntiLink(conn, msg, body, from, sender, botNumber) {
    if (!from.endsWith('@g.us')) return false;
    if (!(await getGroupSetting(botNumber, from, 'antilink'))) return false;
    
    const linkRegex = /(https?:\/\/)?(www\.)?(chat\.whatsapp\.com|whatsapp\.com|instagram\.com|twitter\.com|facebook\.com|t\.me|telegram\.me|discord\.gg)/gi;
    if (!linkRegex.test(body)) return false;
    
    await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
    const userName = await getContactName(conn, sender);
    await conn.sendMessage(from, { 
        text: fancy(`⚠️ @${sender.split('@')[0]} (${userName}) - Links are not allowed! Message deleted.`),
        mentions: [sender]
    }).catch(() => {});
    return true;
}

async function handleAntiSpam(conn, msg, from, sender, botNumber) {
    if (!(await getGroupSetting(botNumber, from, 'antispam'))) return false;
    
    const now = Date.now();
    const key = `${from}:${sender}`;
    const limit = await getGroupSetting(botNumber, from, 'antiSpamLimit');
    const interval = await getGroupSetting(botNumber, from, 'antiSpamInterval');
    
    let botSpam = spamTracker.get(botNumber);
    if (!botSpam) {
        botSpam = new Map();
        spamTracker.set(botNumber, botSpam);
    }
    
    let record = botSpam.get(key) || { count: 0, timestamp: now };
    if (now - record.timestamp > interval) {
        record = { count: 1, timestamp: now };
    } else {
        record.count++;
    }
    botSpam.set(key, record);
    
    if (record.count > limit) {
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const userName = await getContactName(conn, sender);
        await conn.sendMessage(from, {
            text: fancy(`⚠️ @${sender.split('@')[0]} (${userName}) - Sending too fast! Please slow down.`),
            mentions: [sender]
        }).catch(() => {});
        return true;
    }
    return false;
}

async function handleAntiCall(conn, call, botNumber) {
    if (!getBotSetting(botNumber, 'anticall')) return;
    await conn.rejectCall(call.id, call.from).catch(() => {});
    if (!config.ownerNumber.includes(call.from.split('@')[0])) {
        await conn.updateBlockStatus(call.from, 'block').catch(() => {});
    }
}

// ==================== AUTO FEATURES ====================
async function handleAutoStatus(conn, statusMsg, botNumber) {
    if (!getBotSetting(botNumber, 'autostatus')) return;
    if (statusMsg.key.remoteJid !== 'status@broadcast') return;
    
    const actions = getBotSetting(botNumber, 'autoStatusActions');
    const statusId = statusMsg.key.id;
    
    let botStatusCache = statusCache.get(botNumber);
    if (!botStatusCache) {
        botStatusCache = new Set();
        statusCache.set(botNumber, botStatusCache);
    }
    if (botStatusCache.has(statusId)) return;
    botStatusCache.add(statusId);
    
    if (actions.includes('view')) await conn.readMessages([statusMsg.key]).catch(() => {});
    if (actions.includes('react')) {
        const emojis = getBotSetting(botNumber, 'autoReactEmojis');
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        await conn.sendMessage('status@broadcast', { react: { text: emoji, key: statusMsg.key } }).catch(() => {});
    }
}

async function updateAutoBio(conn, botNumber) {
    if (!getBotSetting(botNumber, 'autoBio')) return;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const bio = `${getBotSetting(botNumber, 'developer')} | Uptime: ${hours}h ${minutes}m | INSIDIOUS V${getBotSetting(botNumber, 'version')}`;
    await conn.updateProfileStatus(bio).catch(() => {});
}

// ==================== AI CHATBOT ====================
async function handleChatbot(conn, msg, from, body, sender, botNumber) {
    if (!getBotSetting(botNumber, 'chatbot')) return false;
    
    const isGroup = from.endsWith('@g.us');
    if (isGroup) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const botJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';
        const isReplyToBot = msg.message?.extendedTextMessage?.contextInfo?.stanzaId &&
                             msg.message.extendedTextMessage.contextInfo.participant === botJid;
        if (!mentioned.includes(botJid) && !isReplyToBot) return false;
    }
    
    await conn.sendPresenceUpdate('composing', from);
    
    const systemPrompt = `You are INSIDIOUS V${getBotSetting(botNumber, 'version')}, created by Stanley Assanaly. Stanley is a 22-year-old Tanzanian software engineer. Reply in the user's language, be helpful and concise.`;
    
    try {
        const url = getBotSetting(botNumber, 'aiApiUrl') + encodeURIComponent(body) + '?system=' + encodeURIComponent(systemPrompt);
        const res = await axios.get(url, { timeout: 10000 });
        await conn.sendMessage(from, { text: fancy(res.data) }, { quoted: msg }).catch(() => {});
        return true;
    } catch { 
        return false; 
    }
}

// ==================== COMMAND LOADER ====================
async function loadCommands(dir, baseDir = dir) {
    const commands = new Map();
    const items = await fs.readdir(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            const subCommands = await loadCommands(fullPath, baseDir);
            subCommands.forEach((cmd, name) => commands.set(name, cmd));
        } else if (item.endsWith('.js')) {
            try {
                const cmd = require(fullPath);
                const cmdName = path.basename(item, '.js');
                if (cmd.name) commands.set(cmd.name, cmd);
                if (cmd.aliases?.forEach) cmd.aliases.forEach(alias => commands.set(alias, cmd));
                if (!cmd.name || cmd.name !== cmdName) commands.set(cmdName, cmd);
            } catch (e) { 
                console.error(`Failed to load ${fullPath}:`, e); 
            }
        }
    }
    return commands;
}

// ==================== MAIN MESSAGE HANDLER ====================
module.exports = async (conn, m) => {
    try {
        if (!m.messages?.[0]) return;
        let msg = m.messages[0];
        if (!msg.message) return;

        const botNumber = conn.user.id.split(':')[0];
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.split('@')[0];
        const isFromMe = msg.key.fromMe || false;

        const isOwner = isFromMe || isBotOwner(botNumber, senderNumber) || isGlobalAdmin(senderNumber);

        if (msg.key.remoteJid === 'status@broadcast') {
            await handleAutoStatus(conn, msg, botNumber);
            return;
        }

        await loadBotSettings(botNumber);
        msg = enhanceMessage(conn, msg);

        const from = msg.key.remoteJid;
        const body = extractMessageText(msg);
        const isGroup = from.endsWith('@g.us');

        // Store for anti-delete
        if (body) {
            let botMsgStore = messageStore.get(botNumber);
            if (!botMsgStore) {
                botMsgStore = new Map();
                messageStore.set(botNumber, botMsgStore);
            }
            botMsgStore.set(msg.key.id, { content: body, sender });
        }

        // Rate limit check
        const rateCheck = checkRateLimit(botNumber, sender);
        if (!rateCheck.allowed && !isOwner && getBotSetting(botNumber, 'enableRateLimit')) {
            return;
        }

        // Auto read
        if (getBotSetting(botNumber, 'autoRead')) {
            await conn.readMessages([msg.key]).catch(() => {});
        }

        // Anti features (skip owners)
        if (!isOwner) {
            if (await handleAntiSpam(conn, msg, from, sender, botNumber)) return;
            if (isGroup && await handleAntiLink(conn, msg, body, from, sender, botNumber)) return;
        }

        // Chatbot
        if (body && !body.startsWith(getBotSetting(botNumber, 'prefix')) && !isOwner) {
            await handleChatbot(conn, msg, from, body, sender, botNumber);
        }

    } catch (err) {
        console.error('Handler Error:', err);
    }
};

// ==================== GROUP UPDATE HANDLER ====================
module.exports.handleGroupUpdate = async (conn, update) => {
    const botNumber = conn.user.id.split(':')[0];
    await loadBotSettings(botNumber);
    const { id, participants, action } = update;
    
    if (action === 'add') {
        for (const p of participants) {
            const groupName = await getGroupName(conn, id);
            const userName = await getContactName(conn, p);
            console.log(`➕ ${userName} joined ${groupName}`);
        }
    }
};

// ==================== CALL HANDLER ====================
module.exports.handleCall = async (conn, call) => {
    const botNumber = conn.user.id.split(':')[0];
    await handleAntiCall(conn, call, botNumber);
};

// ==================== INITIALIZATION ====================
module.exports.init = async (conn) => {
    console.log(fancy('[SYSTEM] Initializing INSIDIOUS: THE LAST KEY...'));
    
    await loadBotId();
    const botNumber = conn.user.id.split(':')[0];
    await loadBotSettings(botNumber);
    
    const cmdPath = path.join(__dirname, 'commands');
    if (await fs.pathExists(cmdPath)) {
        global.commands = await loadCommands(cmdPath);
        console.log(fancy(`📁 Loaded ${global.commands.size} commands.`));
    } else {
        global.commands = new Map();
        console.log(fancy('⚠️ Commands folder not found. Creating...'));
        await fs.ensureDir(cmdPath);
    }
    
    if (getBotSetting(botNumber, 'autoBio')) {
        setInterval(() => updateAutoBio(conn, botNumber), 60000);
        await updateAutoBio(conn, botNumber);
    }
    
    console.log(fancy(`🔐 Bot ID: ${botSecretId}`));
    console.log(fancy(`📱 Bot Number: ${botNumber}`));
    console.log(fancy(`🌐 Mode: ${getBotSetting(botNumber, 'mode').toUpperCase()}`));
    console.log(fancy('[SYSTEM] ✅ All systems ready'));
};

// ==================== EXPORTS ====================
module.exports.getBotId = () => botSecretId;
module.exports.loadBotSettings = loadBotSettings;
module.exports.saveBotSettings = saveBotSettings;
module.exports.getBotSetting = getBotSetting;
module.exports.getGroupSetting = getGroupSetting;
module.exports.setGroupSetting = setGroupSetting;
module.exports.fancy = fancy;
