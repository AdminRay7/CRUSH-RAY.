const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const P = require('pino');
const handler = require('./handler');
const mongoose = require('mongoose');
const readline = require('readline');

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/whatsapp_bot').then(() => {
    console.log('✅ Database Connected');
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const conn = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: P({ level: 'silent' })
    });
    
    conn.ev.on('creds.update', saveCreds);
    
    conn.ev.on('connection.update', async (update) => {
        const { connection } = update;
        
        if (connection === 'open') {
            console.log('\n✅ Bot is Online!');
            console.log(`📱 Bot Number: ${conn.user.id.split(':')[0]}`);
            console.log('💻 Type "exit" to stop the bot\n');
            
            await handler.init(conn);
            
            // CLI commands
            rl.on('line', async (input) => {
                if (input.toLowerCase() === 'exit') {
                    console.log('Shutting down...');
                    await mongoose.disconnect();
                    process.exit(0);
                } else if (input.toLowerCase() === 'status') {
                    console.log(`Bot Status: ONLINE`);
                    console.log(`Connected as: ${conn.user.id}`);
                } else if (input.toLowerCase() === 'help') {
                    console.log(`
Available Commands:
  exit   - Stop the bot
  status - Show bot status
  help   - Show this message
                    `);
                }
            });
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
