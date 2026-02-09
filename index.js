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
        '• Short videos (≤2min) → stream instantly\n' +
        '• Long videos → download & send\n\n' +
        'Send a YouTube link to start!',
        { parse_mode: 'Markdown' }
    );
});

// ===== BOT TEXT HANDLER =====
bot.on('text', async ctx => {
    const url = ctx.message.text.trim();

    if (!ytdl.validateURL(url)) {
        return ctx.reply('❌ Invalid YouTube link!\n\nSend a valid YouTube URL.');
    }

    const statusMsg = await ctx.reply('⏳ Fetching video info...');

    try {
        // FIXED: Added User-Agent to bypass age verification
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });

        const v = info.videoDetails;
        const title = v.title.slice(0, 50);
        const duration = Number(v.lengthSeconds);

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎥 ${title}\n⬇️ Preparing video... (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})`
        );

        if (duration <= 120) {
            // Short video → stream
            await streamVideo(ctx, url, title, duration, statusMsg);
        } else {
            // Long video → download
            await downloadVideo(ctx, url, title, duration, statusMsg);
        }

    } catch (err) {
        console.error('Video processing error:', err.message);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `❌ Failed to process video:\n\`${err.message}\`\n\nTry another link!`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ===== STREAM SHORT VIDEO (<= 2min) =====
async function streamVideo(ctx, url, title, duration, statusMsg) {
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎥 ${title}\n📡 Streaming...`
        );

        // FIXED: User-Agent + reliable quality
        const stream = ytdl(url, {
            filter: f => f.hasVideo && f.hasAudio,
            quality: ['18', '22', '137+140'], // Fallback qualities
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });

        await ctx.telegram.sendVideo(
            ctx.chat.id,
            stream,
            {
                caption: `🎥 ${title}\n⏱️ ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}\n✨ Streamed instantly!`,
                supports_streaming: true,
                thumbnail: undefined // Avoid thumbnail issues
            }
        );

        await ctx.deleteMessage(statusMsg.message_id);
        ctx.reply('✨ Video streamed successfully!');

    } catch (err) {
        console.log('Stream failed, trying download...', err.message);
        await ctx.deleteMessage(statusMsg.message_id);
        await downloadVideo(ctx, url, title, duration);
    }
}

// ===== DOWNLOAD LONG VIDEO =====
async function downloadVideo(ctx, url, title, duration, statusMsg) {
    const filename = `${Date.now()}-${title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
    const filepath = path.join(tempDir, filename);

    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎥 ${title}\n⬇️ Downloading...`
        );

        // FIXED: Reliable quality selection + User-Agent
        const stream = ytdl(url, {
            filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4',
            quality: 'highestvideo[height<=720]+bestaudio[ext=m4a]/best[ext=mp4]',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });

        const write = fs.createWriteStream(filepath);
        stream.pipe(write);

        await new Promise((resolve, reject) => {
            stream.on('error', reject);
            write.on('error', reject);
            write.on('finish', () => {
                console.log('Download finished:', filepath);
                resolve();
            });
        });

        const stats = fs.statSync(filepath);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB > 48) {
            fs.unlinkSync(filepath);
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `📦 Video too large (${sizeMB.toFixed(1)}MB)\nMax: 48MB`
            );
            return;
        }

        await ctx.telegram.sendVideo(
            ctx.chat.id,
            { source: filepath },
            {
                caption: `🎥 ${title}\n⏱️ ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}\n📥 ${sizeMB.toFixed(1)}MB`,
                supports_streaming: true
            }
        );

        // Cleanup
        fs.unlinkSync(filepath);
        await ctx.deleteMessage(statusMsg.message_id);
        ctx.reply('✅ Downloaded & sent successfully!');

    } catch (err) {
        console.error('Download error:', err.message);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `❌ Download failed:\n\`${err.message}\``,
            { parse_mode: 'Markdown' }
        );
    }
}

// ===== LAUNCH BOT =====
bot.launch()
    .then(() => console.log('🤖 YouTube Bot running on Render!'))
    .catch(err => console.error('BOT FAILED:', err));

// ===== GRACEFUL SHUTDOWN =====
process.once('SIGINT', () => {
    console.log('SIGINT received, cleaning up...');
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    console.log('SIGTERM received, cleaning up...');
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
    bot.stop('SIGTERM');
});