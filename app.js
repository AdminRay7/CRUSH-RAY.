const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const handler = require('./handler');

// ==================== CONFIGURATION ====================
let config = {};
try { config = require('./config'); } catch { config = {}; }

// MongoDB Connection
const MONGODB_URI = config.mongodbUri || 'mongodb://localhost:27017/insidious_bot';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB Connected Successfully');
}).catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
});

// Create readline interface for CLI input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ==================== BOT INSTANCE MANAGER ====================
class BotInstance {
    constructor(sessionName = 'default') {
        this.sessionName = sessionName;
        this.conn = null;
        this.isConnected = false;
        this.botNumber = null;
    }

    async start() {
        console.log(`\n🚀 Starting INSIDIOUS Bot...`);
        console.log(`📁 Session: ${this.sessionName}`);
        
        const sessionDir = path.join(__dirname, 'sessions', this.sessionName);
        await fs.ensureDir(sessionDir);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        this.conn = makeWASocket({
            auth: state,
            printQRInTerminal: false, // Disable QR, use pairing code
            logger: P({ level: 'silent' }),
            browser: Browsers.macOS('Safari'),
            defaultQueryTimeoutMs: 10000,
            keepAliveIntervalMs: 30000,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            patchMessageBeforeSending: (message) => {
                const requireCheck = (message.messageContextInfo || {})?.deviceListMetadata;
                if (requireCheck) {
                    message = { ...message, messageContextInfo: undefined };
                }
                return message;
            }
        });
        
        this.conn.ev.on('creds.update', saveCreds);
        
        // Handle connection updates with pairing code
        this.conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin } = update;
            
            // Request pairing code if not registered
            if (!this.conn.authState.creds.registered && !this.pairingRequested) {
                this.pairingRequested = true;
                await this.requestPairingCode();
            }
            
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom) ? 
                    lastDisconnect.error.output.statusCode : 500;
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Connection closed. Reconnecting in 5 seconds...');
                    setTimeout(() => this.start(), 5000);
                } else {
                    console.log('🔒 Session logged out. Please restart bot to pair again.');
                    process.exit(0);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.botNumber = this.conn.user.id.split(':')[0];
                console.log(`\n✅ Bot Connected Successfully!`);
                console.log(`📱 Bot Number: ${this.botNumber}`);
                console.log(`🌐 Status: ${this.isConnected ? 'ONLINE' : 'OFFLINE'}`);
                
                // Initialize bot handler
                await handler.init(this.conn);
                
                // Send startup message to owners
                await this.sendStartupMessage();
                
                // Setup CLI commands
                this.setupCliCommands();
            }
        });
        
        // Handle messages
        this.conn.ev.on('messages.upsert', async (m) => {
            await handler(this.conn, m);
        });
        
        // Handle group updates
        this.conn.ev.on('group-participants.update', async (update) => {
            await handler.handleGroupUpdate(this.conn, update);
        });
        
        // Handle calls
        this.conn.ev.on('call', async (call) => {
            await handler.handleCall(this.conn, call);
        });
        
        // Handle presence updates (optional)
        this.conn.ev.on('presence.update', async (update) => {
            // You can add presence tracking here if needed
        });
    }
    
    async requestPairingCode() {
        return new Promise((resolve) => {
            rl.question('\n📱 Enter your WhatsApp number with country code (e.g., 255787069580): ', async (number) => {
                const cleanNumber = number.replace(/[^0-9]/g, '');
                
                if (!cleanNumber || cleanNumber.length < 10) {
                    console.log('❌ Invalid number format. Please include country code.');
                    return this.requestPairingCode();
                }
                
                console.log(`📡 Requesting pairing code for +${cleanNumber}...`);
                
                try {
                    const code = await this.conn.requestPairingCode(cleanNumber);
                    console.log(`\n🔐 =====================================`);
                    console.log(`🔐 YOUR PAIRING CODE: ${code}`);
                    console.log(`🔐 =====================================\n`);
                    console.log(`📱 Instructions:`);
                    console.log(`   1. Open WhatsApp on your phone`);
                    console.log(`   2. Go to Settings → Linked Devices`);
                    console.log(`   3. Tap "Link a Device" → "Link with phone number"`);
                    console.log(`   4. Enter this 8-digit code: ${code}`);
                    console.log(`\n⏳ Waiting for connection...\n`);
                    resolve(code);
                } catch (error) {
                    console.error(`❌ Failed to get pairing code: ${error.message}`);
                    console.log('💡 Make sure your number is valid and WhatsApp is accessible.');
                    this.pairingRequested = false;
                    setTimeout(() => this.requestPairingCode(), 5000);
                }
                rl.close();
            });
        });
    }
    
    async sendStartupMessage() {
        const owners = config.ownerNumber || [];
        const botNumber = this.botNumber;
        
        for (const owner of owners) {
            try {
                const ownerJid = owner + '@s.whatsapp.net';
                const startupMsg = `
╭━━━━━━━━━━━━━━╮
   ✅ *INSIDIOUS BOT ONLINE*
╰━━━━━━━━━━━━━━╯

🤖 *Bot Info:*
• Name: INSIDIOUS: THE LAST KEY
• Number: ${botNumber}
• Version: 2.1.1
• Status: ONLINE ✅

📊 *System Info:*
• Uptime: Just Started
• Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB
• Platform: ${process.platform}

👑 *Developer:* Stanley Assanaly
📱 *Contact:* +255787069580

⚡ *All systems operational!*
                `;
                await this.conn.sendMessage(ownerJid, { text: startupMsg.trim() });
            } catch (error) {
                console.log(`Failed to send startup message to ${owner}:`, error.message);
            }
        }
    }
    
    setupCliCommands() {
        const cli = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `🤖 [${this.botNumber}]> `
        });
        
        cli.prompt();
        
        cli.on('line', async (input) => {
            const cmd = input.trim().toLowerCase();
            
            switch(cmd) {
                case 'status':
                    console.log(`\n📊 Bot Status:`);
                    console.log(`   Number: ${this.botNumber}`);
                    console.log(`   Status: ${this.isConnected ? 'ONLINE ✅' : 'OFFLINE ❌'}`);
                    console.log(`   Uptime: ${Math.floor(process.uptime())} seconds`);
                    console.log(`   Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB\n`);
                    break;
                    
                case 'help':
                    console.log(`\n📚 Available Commands:`);
                    console.log(`   status - Show bot status`);
                    console.log(`   logout - Logout current session`);
                    console.log(`   restart - Restart bot`);
                    console.log(`   help   - Show this menu`);
                    console.log(`   exit   - Stop bot\n`);
                    break;
                    
                case 'logout':
                    console.log(`🔒 Logging out...`);
                    await this.conn.logout();
                    process.exit(0);
                    break;
                    
                case 'restart':
                    console.log(`🔄 Restarting bot...`);
                    process.exit(0);
                    break;
                    
                case 'exit':
                    console.log(`👋 Shutting down...`);
                    process.exit(0);
                    break;
                    
                default:
                    if (cmd) console.log(`❌ Unknown command. Type 'help' for options.`);
            }
            
            cli.prompt();
        });
        
        cli.on('close', () => {
            console.log('\n👋 Goodbye!');
            process.exit(0);
        });
    }
}

// ==================== MULTI-BOT MANAGER ====================
class BotManager {
    constructor() {
        this.bots = new Map();
    }
    
    async addBot(sessionName) {
        if (this.bots.has(sessionName)) {
            console.log(`❌ Bot "${sessionName}" already exists.`);
            return false;
        }
        
        const bot = new BotInstance(sessionName);
        this.bots.set(sessionName, bot);
        
        try {
            await bot.start();
            console.log(`✅ Bot "${sessionName}" started successfully.`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to start bot "${sessionName}":`, error.message);
            this.bots.delete(sessionName);
            return false;
        }
    }
    
    async removeBot(sessionName) {
        const bot = this.bots.get(sessionName);
        if (!bot) {
            console.log(`❌ Bot "${sessionName}" not found.`);
            return false;
        }
        
        try {
            await bot.conn.logout();
            this.bots.delete(sessionName);
            console.log(`✅ Bot "${sessionName}" stopped.`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to stop bot "${sessionName}":`, error.message);
            return false;
        }
    }
    
    listBots() {
        const bots = Array.from(this.bots.entries()).map(([name, bot]) => ({
            name,
            number: bot.botNumber || 'Unknown',
            status: bot.isConnected ? 'Online' : 'Offline'
        }));
        
        console.log(`\n📋 Active Bots (${bots.length}):`);
        bots.forEach((bot, i) => {
            console.log(`   ${i + 1}. ${bot.name} - ${bot.number} [${bot.status}]`);
        });
        console.log('');
        return bots;
    }
}

// ==================== MAIN APPLICATION ====================
async function main() {
    console.log(`
╔═══════════════════════════════════════╗
║   INSIDIOUS: THE LAST KEY v2.1.1     ║
║   WhatsApp Bot with Pairing Code      ║
║   Developed by Stanley Assanaly       ║
╚═══════════════════════════════════════╝
    `);
    
    const manager = new BotManager();
    
    // Check if session name is provided as command line argument
    const sessionName = process.argv[2] || 'default';
    
    console.log(`🎯 Starting bot with session: ${sessionName}`);
    console.log(`💡 To add another bot: node app.js <session_name>\n`);
    
    await manager.addBot(sessionName);
    
    // Handle graceful shutdown
    const shutdown = async () => {
        console.log('\n🛑 Shutting down gracefully...');
        for (const [name, bot] of manager.bots) {
            try {
                await bot.conn.logout();
                console.log(`   ✅ Bot "${name}" disconnected`);
            } catch (error) {
                console.log(`   ❌ Error disconnecting "${name}":`, error.message);
            }
        }
        await mongoose.disconnect();
        console.log('👋 Goodbye!');
        process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// ==================== START APPLICATION ====================
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { BotInstance, BotManager };
