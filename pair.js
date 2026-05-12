const { makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');

const PAIRING_NUMBER = process.argv[2] || '254794376595';

async function pairBot() {
    console.log(`🔐 Pairing bot for +${PAIRING_NUMBER}...`);
    
    // Clear existing sessions
    await fs.remove('./sessions');
    
    const { state, saveCreds } = await useMultiFileAuthState('./sessions');
    
    const conn = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Safari'),
        logger: { level: 'silent' }
    });
    
    conn.ev.on('creds.update', saveCreds);
    
    conn.ev.on('connection.update', async (update) => {
        const { connection } = update;
        
        if (connection === 'open') {
            try {
                const code = await conn.requestPairingCode(PAIRING_NUMBER);
                console.log(`\n🔐 PAIRING CODE: ${code}\n`);
                console.log(`Enter this code in WhatsApp: Settings → Linked Devices\n`);
                console.log(`Waiting for connection...`);
            } catch (error) {
                console.error(`Error: ${error.message}`);
                process.exit(1);
            }
        } else if (connection === 'close') {
            console.log(`\n✅ Bot paired successfully!`);
            console.log(`Run 'node app.js' to start the bot.\n`);
            process.exit(0);
        }
    });
}

pairBot();