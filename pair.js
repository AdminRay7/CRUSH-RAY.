const WhatsAppClient = require('easy-baileys');

(async () => {
    try {
        const client = await WhatsAppClient.create('./auth', {
            browser: ["INSIDIOUS", "Chrome", "2.1.1"],
            printQRInTerminal: false,
            mobile: false,
        });
        
        const code = await client.getPairingCode(255787069580); // Your phone number [citation:3]
        console.log(`\n🔐 PAIRING CODE: ${code}\n`);
        console.log('Enter this code in WhatsApp: Settings → Linked Devices');
        
    } catch (error) {
        console.error('Error:', error.message);
    }
})();
