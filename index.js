const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');
const handler = require('./handler');
const mongoose = require('mongoose');
const readline = require('readline');

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/whatsapp_bot').then(() => {
    console.log('✅ MongoDB Connected');
});

// Create interface for phone number input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const conn = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Disable QR code
        logger: P({ level: 'silent' }),
        browser: ['INSIDIOUS BOT', 'Chrome', '1.0.0']
    });
    
    conn.ev.on('creds.update', saveCreds);
    
    // Handle connection updates
    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        // Check if not registered - request pairing code automatically
        if (!conn.authState.creds.registered) {
            rl.question('Enter your WhatsApp number with country code (e.g., 255787069580): ', async (number) => {
                const cleanNumber = number.replace(/[^0-9]/g, '');
                console.log('📱 Requesting pairing code...');
                const code = await conn.requestPairingCode(cleanNumber); [citation:1][citation:3]
                console.log(`\n🔐 YOUR PAIRING CODE: ${code}\n`);
                console.log('Go to WhatsApp → Settings → Linked Devices → Link with phone number');
                console.log('Enter this 8-digit code to connect your bot!\n');
                rl.close();
            });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected Successfully!');
            await handler.init(conn);
        }
    });
    
    conn.ev.on('messages.upsert', async (m) => {
        await handler(conn, m);
    });
    
    conn.ev.on('group-participants.update', async (update) => {
        await handler.handleGroupUpdate(conn, update);
    });
    
    conn.ev.on('call', async (call) => {
        await handler.handleCall(conn, call);
    });
}

startBot().catch(console.error);
