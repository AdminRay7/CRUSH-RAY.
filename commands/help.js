module.exports = {
    name: 'help',
    aliases: ['menu', 'commands', 'cmdlist'],
    ownerOnly: false,
    adminOnly: false,
    description: 'Show all available commands',
    async execute(conn, msg, args, options) {
        const isOwner = options.isOwner;
        const isAdmin = options.isGroupAdmin;
        
        let helpText = `╭━━━━━━━━━━━━━━╮\n`;
        helpText += `   📚 *COMMAND LIST*\n`;
        helpText += `╰━━━━━━━━━━━━━━╯\n\n`;
        
        helpText += `🔹 *General Commands*\n`;
        helpText += `   ${await options.getBotSetting('prefix')}ping - Check bot response\n`;
        helpText += `   ${await options.getBotSetting('prefix')}help - Show this menu\n`;
        
        if (isOwner || isAdmin) {
            helpText += `\n🔸 *Admin Commands*\n`;
            helpText += `   ${await options.getBotSetting('prefix')}warn @user - Warn a user\n`;
            helpText += `   ${await options.getBotSetting('prefix')}kick @user - Remove user\n`;
            helpText += `   ${await options.getBotSetting('prefix')}promote @user - Make admin\n`;
            helpText += `   ${await options.getBotSetting('prefix')}demote @user - Remove admin\n`;
            helpText += `   ${await options.getBotSetting('prefix')}settings - View group settings\n`;
            helpText += `   ${await options.getBotSetting('prefix')}set antilink on/off - Toggle anti-link\n`;
        }
        
        if (isOwner) {
            helpText += `\n🔹 *Owner Commands*\n`;
            helpText += `   ${await options.getBotSetting('prefix')}set mode public/self - Change bot mode\n`;
            helpText += `   ${await options.getBotSetting('prefix')}set prefix <symbol> - Change command prefix\n`;
            helpText += `   ${await options.getBotSetting('prefix')}broadcast <message> - Send to all groups\n`;
            helpText += `   ${await options.getBotSetting('prefix')}addbot <number> - Add new bot session\n`;
            helpText += `   ${await options.getBotSetting('prefix')}removebot <number> - Remove bot session\n`;
        }
        
        helpText += `\n📱 *Developer:* ${await options.getBotSetting('developer')}\n`;
        helpText += `💾 *Version:* ${await options.getBotSetting('version')}\n`;
        helpText += `📊 *Status:* Active\n`;
        
        await options.reply(options.fancy(helpText));
    }
};
