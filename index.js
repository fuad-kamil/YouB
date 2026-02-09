require('dotenv').config();
const { Telegraf } = require('telegraf');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing in .env');

const bot = new Telegraf(BOT_TOKEN);
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// ===== GLOBAL ERRORS =====
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ===== BOT START =====
bot.start(ctx => {
    ctx.reply(
        '🎥 *Smart YouTube Bot*\n\n' +
        '• Short videos → stream quickly\n' +
        '• Long videos → download & send\n\n' +
        'Send a YouTube link.',
        { parse_mode: 'Markdown' }
    );
});

// ===== BOT TEXT HANDLER =====
bot.on('text', async ctx => {
    const url = ctx.message.text.trim();

    if (!ytdl.validateURL(url)) {
        return ctx.reply('❌ Invalid YouTube link');
    }

    const statusMsg = await ctx.reply('⏳ Fetching video info...');

    try {
        const info = await ytdl.getInfo(url);
        const v = info.videoDetails;
        const title = v.title.slice(0, 50);
        const duration = Number(v.lengthSeconds);

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎥 ${title}\n⬇️ Downloading...`
        );

        if (duration <= 120) {
            // Short video → stream
            await streamVideo(ctx, url, title, duration, statusMsg);
        } else {
            // Long video → download
            await downloadVideo(ctx, url, title, duration, statusMsg);
        }

    } catch (err) {
        console.error(err);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '❌ Failed to process video'
        );
    }
});

// ===== STREAM SHORT VIDEO =====
async function streamVideo(ctx, url, title, duration, statusMsg) {
    try {
        const stream = ytdl(url, { filter: f => f.hasVideo && f.hasAudio, quality: '18' });

        await ctx.telegram.sendVideo(
            ctx.chat.id,
            stream,
            {
                caption: `🎥 ${title}\n⏱️ ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
                supports_streaming: true
            }
        );

        await ctx.deleteMessage(statusMsg.message_id);
        ctx.reply('✨ Streamed successfully!');

    } catch (err) {
        console.log('Stream failed, falling back to download...', err);
        await downloadVideo(ctx, url, title, duration, statusMsg);
    }
}

// ===== DOWNLOAD LONG VIDEO =====
async function downloadVideo(ctx, url, title, duration, statusMsg) {
    const filename = `${Date.now()}-${title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
    const filepath = path.join(tempDir, filename);

    const stream = ytdl(url, { filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4', quality: 'highest' });
    const write = fs.createWriteStream(filepath);
    stream.pipe(write);

    await new Promise((resolve, reject) => {
        stream.on('error', reject);
        write.on('error', reject);
        write.on('finish', resolve);
    });

    const sizeMB = fs.statSync(filepath).size / (1024 * 1024);
    if (sizeMB > 48) {
        fs.unlinkSync(filepath);
        return ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '📦 Video too large (max 48MB)'
        );
    }

    await ctx.telegram.sendVideo(
        ctx.chat.id,
        { source: filepath },
        {
            caption: `🎥 ${title}\n⏱️ ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
            supports_streaming: true
        }
    );

    fs.unlinkSync(filepath);
    await ctx.deleteMessage(statusMsg.message_id);
    ctx.reply('✅ Downloaded & sent successfully!');
}

// ===== LAUNCH BOT =====
bot.launch()
    .then(() => console.log('🤖 Smart YouTube Bot running (polling mode)'))
    .catch(err => console.error('BOT FAILED TO START:', err));

// ===== CLEAN EXIT =====
process.once('SIGINT', () => { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true }); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true }); bot.stop('SIGTERM'); });
