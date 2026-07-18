const { EmbedBuilder } = require('discord.js');
const { isAuthorized } = require('../../utils/permissions');
const config = require('../../utils/config');

module.exports = {
    name: 'hof',
    guildOnly: true,
    restricted: true,
    description: 'Adds the replied message to the Hall of Fame.',
    async execute(message, args, client) {
        if (!isAuthorized(message)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        if (!message.reference) {
            return message.reply('❌ You must reply to a message to add it to the Hall of Fame!');
        }

        const channelId = config.hallOfFameChannelId;

        try {
            const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);

            const targetChannel = await client.channels.fetch(channelId).catch(() => null);
            if (!targetChannel) {
                return message.reply(`❌ Hall of Fame channel not found. Please check if <#${channelId}> exists and I have access to it.`);
            }

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: referencedMessage.author.tag, 
                    iconURL: referencedMessage.author.displayAvatarURL({ dynamic: true }) 
                })
                .setColor('#FFD700')
                .setDescription(`${referencedMessage.content || '*No text content*'}\n\n[**[Jump to Message]**](${referencedMessage.url})`)
                .setTimestamp(referencedMessage.createdAt)
                .setFooter({
                    text: `Added by ${message.author.tag} in #${message.channel.name}`,
                    iconURL: message.author.displayAvatarURL({ dynamic: true })
                });

            const attachments = [];
            let imageSet = false;

            // Handle normal attachments
            referencedMessage.attachments.forEach(attachment => {
                const contentType = attachment.contentType || '';
                if (!imageSet && contentType.startsWith('image/')) {
                    embed.setImage(attachment.url);
                    imageSet = true;
                } else {
                    attachments.push({ attachment: attachment.url, name: attachment.name });
                }
            });

            // Handle embeds (like tenor gifs) if no image attachment was found
            if (!imageSet && referencedMessage.embeds.length > 0) {
                const embedWithImage = referencedMessage.embeds.find(e => e.image || e.thumbnail);
                if (embedWithImage) {
                    embed.setImage(embedWithImage.image?.url || embedWithImage.thumbnail?.url);
                    imageSet = true;
                }
            }

            const messageOptions = { embeds: [embed] };
            if (attachments.length > 0) {
                messageOptions.files = attachments;
            }

            await targetChannel.send(messageOptions);
            
            await message.reply(`✅ Message successfully added to <#${channelId}>!`);

        } catch (error) {
            console.error('[HOF ERROR]', error);
            message.reply('❌ An error occurred while adding the message to the Hall of Fame. Make sure I have permissions to read/send messages there.');
        }
    }
};
