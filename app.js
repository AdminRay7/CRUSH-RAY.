const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs-extra');
const path = require('path');
const dns = require('dns');

// ==================== CONFIGURATION ====================
let config = {};
try { config = require('./config'); } catch { config = {}; }

console.log('📁 Using file-based storage');
console.log('🌐 Testing network connectivity...\n');

// Test network connectivity
async function testNetwork() {
    console.log('🔍 Testing network connection to WhatsApp...');
    
    // Test DNS resolution
    dns.lookup('web.whatsapp.com', (err, address) => {
        if (err) {
            console.error('❌ DNS Resolution Failed:', err.message);
        } else {
            console.log('✅ DNS Resolution OK:', address);
        }
    });
    
    // Test direct connection
    const https = require('https');
    const options = {
        hostname: 'web.whatsapp.com',
        port: 443,
        path: '/',
        method: 'HEAD',
        timeout: 5000
    };
    
    const req = https.request(options, (res) => {
        console.log('✅ HTTPS Connection OK - Status:', res.statusCode);
    });
    
    req.on('error', (err) => {
        console.error('❌ HTTPS Connection Failed:', err.message);
    });
    
    req.on('timeout', () => {
        console.error('❌ Connection Timeout - Please check firewall settings');
        req.destroy();
    });
    
    req.end();
}

// ==================== PAIRING SETUP ====================
const PAIRING_NUMBER = process.env.PAIRING_NUMBER || config.pairingNumber || '254794376595';
let pairingCodeRequested = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;

// ==================== BOT INSTANCE ====================
class BotInstance {
    constructor(sessionName = 'default') {
        this.sessionName = sessionName;
        this.conn = null;
        this.isConnected = false;
        this.botNumber = null;
    }

    async start() {
        console.log(`\n🚀 Starting CRUSH RAY Bot...`);
        console.log(`📁 Session: ${this.sessionName}`);
        console.log(`📱 Phone Number: +${PAIRING_NUMBER}`);
        console.log(`🔄 Attempt: ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`);
        
        const sessionDir = path.join(__dirname, 'sessions', this.sessionName);
        await fs.ensureDir(sessionDir);
        
        // Check if session exists
        const credsFile = path.join(sessionDir, 'creds.json');
        const hasSession = await fs.pathExists(credsFile);
        console.log(`💾 Session exists: ${hasSession ? 'YES' : 'NO'}`);
        
        // Get latest version
        const { version, isLatest } = await fetchLatestWaWebVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));
        console.log(`📡 WhatsApp Web Version: ${version.join('.')}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        this.conn = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: P({ level: 'silent' }),
            browser: ['CRUSH RAY', 'Chrome', '2.1.1'],
            defaultQueryTimeoutMs: 120000,
            keepAliveIntervalMs: 30000,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            version: version,
            waitForKeepAliveBeforeConnect: true,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (message) => message,
            options: {
                waWebOptions: {
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });
        
        this.conn.ev.on('creds.update', saveCreds);
        
        // Handle connection updates
        this.conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log(`📡 Connection state: ${connection || 'unknown'}`);
            
            // Request pairing code when connection opens
            if (connection === 'open' && !this.conn.authState.creds.registered && !pairingCodeRequested) {
                pairingCodeRequested = true;
                await this.requestPairingCode();
            }
            
            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error instanceof Boom ? error.output.statusCode : 500;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                
                console.log(`❌ Connection closed. Status: ${statusCode}, Error: ${errorMessage}`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    reconnectAttempts++;
                    
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        const delay = Math.min(10000 * reconnectAttempts, 60000);
                        console.log(`🔄 Reconnecting in ${delay/1000} seconds...`);
                        setTimeout(() => {
                            this.conn?.ws?.close();
                            this.start();
                        }, delay);
                    } else {
                        console.log(`❌ Max reconnection attempts reached.`);
                        console.log(`💡 Try clearing sessions: npm run clear\n`);
                        process.exit(1);
                    }
                } else {
                    console.log('🔒 Session logged out. Please restart with --clear flag.');
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.botNumber = this.conn.user.id.split(':')[0];
                reconnectAttempts = 0;
                console.log(`\n✅========== CRUSH RAY CONNECTED! ==========`);
                console.log(`📱 Bot Number: ${this.botNumber}`);
                console.log(`🟢 Status: ONLINE`);
                console.log(`==========================================\n`);
                await this.sendStartupMessage();
            }
        });
        
        // Handle connection errors
        this.conn.ev.on('connection.error', (err) => {
            console.error('🔌 Connection error:', err.message);
        });
        
        // Handle messages
        this.conn.ev.on('messages.upsert', async (m) => {
            await this.handleMessage(m);
        });
    }
    
    async requestPairingCode() {
        const cleanNumber = PAIRING_NUMBER.replace(/[^0-9]/g, '');
        
        console.log(`\n📡 Requesting pairing code for +${cleanNumber}...`);
        
        // Wait for socket to be ready
        for (let i = 0; i < 5; i++) {
            if (this.conn?.ws?.readyState === 1) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log(`⏳ Waiting for socket... (${i+1}/5)`);
        }
        
        if (this.conn?.ws?.readyState !== 1) {
            console.log('❌ Socket not ready. Retrying in 10 seconds...');
            pairingCodeRequested = false;
            setTimeout(() => this.start(), 10000);
            return;
        }
        
        try {
            const code = await this.conn.requestPairingCode(cleanNumber);
            
            console.log(`\n╔═══════════════════════════════════════════════╗`);
            console.log(`║                                           ║`);
            console.log(`║      🔐 PAIRING CODE: ${code}      ║`);
            console.log(`║                                           ║`);
            console.log(`╚═══════════════════════════════════════════════╝\n`);
            console.log(`📱 HOW TO CONNECT:`);
            console.log(`   1. Open WhatsApp → Settings → Linked Devices`);
            console.log(`   2. Tap "Link a Device"`);
            console.log(`   3. Tap "Link with phone number instead"`);
            console.log(`   4. Enter: ${code}`);
            console.log(`\n✅ Bot will connect once you enter the code!\n`);
            
        } catch (error) {
            console.error(`❌ Pairing error: ${error.message}`);
            
            if (error.message.includes('timeout')) {
                console.log(`⚠️ Connection timeout - Check if port 443 is open`);
            } else if (error.message.includes('ECONNREFUSED')) {
                console.log(`⚠️ Connection refused - Firewall blocking?`);
            }
            
            console.log(`\n🔄 Retrying in 15 seconds...\n`);
            pairingCodeRequested = false;
            setTimeout(() => {
                if (!this.isConnected) {
                    this.conn?.ws?.close();
                }
            }, 15000);
        }
    }
    
    async handleMessage(m) {
        try {
            if (!m.messages?.[0]) return;
            const msg = m.messages[0];
            const from = msg.key.remoteJid;
            const body = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || '';
            
            if (body === '.ping' || body === '!ping') {
                await this.conn.sendMessage(from, { text: '🏓 Pong! CRUSH RAY is crushing it! 💪' });
            }
            
            if (body === '.help' || body === '!help') {
                await this.conn.sendMessage(from, { 
                    text: `⚡ CRUSH RAY BOT ⚡\n\nCommands:\n.ping - Check bot status\n.help - Show this menu\n\nStatus: ONLINE ✅\nDeveloper: Stanley Assanaly` 
                });
            }
        } catch (err) {
            console.error('Message error:', err.message);
        }
    }
    
    async sendStartupMessage() {
        const owners = config.ownerNumber || [];
        for (const owner of owners) {
            try {
                await this.conn.sendMessage(owner + '@s.whatsapp.net', { 
                    text: `✅ CRUSH RAY is ONLINE!\n📱 Number: ${this.botNumber}\n💪 Ready to crush!` 
                });
                console.log(`📨 Startup message sent to ${owner}`);
            } catch (error) {
                console.log(`❌ Could not send startup message to ${owner}`);
            }
        }
    }
}

// ==================== MAIN ====================
async function main() {
    console.log(`\n╔════════════════════════════════════════════╗`);
    console.log(`║         CRUSH RAY - WhatsApp Bot        ║`);
    console.log(`║              Version 2.1.1               ║`);
    console.log(`║        Developed by Stanley Assanaly     ║`);
    console.log(`╚════════════════════════════════════════════╝\n`);
    
    // Run network test
    await testNetwork();
    
    // Clear sessions if flag is set
    if (process.argv.includes('--clear')) {
        const sessionsDir = path.join(__dirname, 'sessions');
        await fs.remove(sessionsDir);
        console.log('🗑️ Cleared all sessions!\n');
    }
    
    const sessionName = process.env.SESSION_NAME || 'default';
    const bot = new BotInstance(sessionName);
    
    await bot.start();
    
    // Keep alive
    setInterval(() => {
        if (bot.isConnected) {
            console.log(`💓 CRUSH RAY | ${new Date().toLocaleTimeString()}`);
        }
    }, 60000);
}

// Handle process errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message);
});

// ==================== START ====================
main().catch(console.error);

module.exports = { BotInstance };onName) {
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
