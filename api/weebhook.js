const { Telegraf, Markup } = require('telegraf');

// 🔥 আপনার দেওয়া টোকেন ও এপিআই কি সরাসরি কোডে যুক্ত করা হলো 🔥
const BOT_TOKEN = '8739819887:AAEK41gSTtlIhp6Cf2vOo8qgAILxMrVAzLk';
const FREECONVERT_API_KEY = 'api_production_af64ad2492341596e04e9eaf9903a77b0faf981014670ebfa58779e782558ca7.6a2bea2e6a1cfab87b30ffec.6a2bed64f56d6c712a44743c';

const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// 🔥 START COMMAND 🔥
// ==========================================
bot.command('start', (ctx) => {
    const msg = `🌟 *স্বাগতম অল-ইন-ওয়ান মিডিয়া কনভার্টার বটে!* 🌟\n\n`
              + `👉 TikTok, Facebook বা YouTube এর যেকোনো ভিডিওর লিংক এখানে পাঠান।\n\n`
              + `বট অটোমেটিক ভিডিওটি ডাউনলোড করবে এবং বাটন ফোনের জন্য *3GP (144p)* কিংবা *MP3 অডিও* তে কনভার্ট করার অপশন দেবে।`;
    ctx.replyWithMarkdown(msg);
});

// ==========================================
// 🔥 FREECONVERT API FUNCTION 🔥
// ==========================================
async function convertMedia(videoUrl, targetFormat) {
    const payload = {
        tasks: {
            "import-vid": { 
                "operation": "import/url", 
                "url": videoUrl 
            },
            "convert-vid": { 
                "operation": "convert", 
                "input": "import-vid", 
                "output_format": targetFormat, // '3gp' অথবা 'mp3'
                "options": targetFormat === '3gp' ? { "video_resolution": "176x144" } : {} 
            },
            "export-url": { 
                "operation": "export/url", 
                "input": "convert-vid" 
            }
        }
    };

    // ১. FreeConvert এ নতুন কাজ পাঠানো
    let createRes = await fetch('https://api.freeconvert.com/v1/process/jobs', {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${FREECONVERT_API_KEY}`, 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify(payload)
    });
    let jobData = await createRes.json();
    if (!jobData.id) throw new Error("FreeConvert API error");
    let jobId = jobData.id;

    // ২. ফাইল কনভার্ট শেষ হওয়া পর্যন্ত অপেক্ষা করা (Polling)
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // ৩ সেকেন্ড পর পর চেক করবে
        
        let statusRes = await fetch(`https://api.freeconvert.com/v1/process/jobs/${jobId}`, {
            headers: { 'Authorization': `Bearer ${FREECONVERT_API_KEY}` }
        });
        let statusData = await statusRes.json();
        
        if (statusData.status === 'finished') {
            const exportTask = statusData.tasks.find(t => t.name === 'export-url');
            return exportTask.result.url;
        } else if (statusData.status === 'failed') {
            throw new Error("Conversion failed");
        }
    }
}

// ==========================================
// 🔥 LINK DETECTOR & SOCIAL DOWNLOADER 🔥
// ==========================================
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlPattern);

    if (!urls) {
        if (!text.startsWith('/')) {
            ctx.reply('❌ কোনো সঠিক লিংক পাওয়া যায়নি! দয়া করে YouTube, Facebook বা TikTok এর লিংক দিন।');
        }
        return;
    }

    const videoLink = urls[0];
    const waitMsg = await ctx.reply('⏳ *লিংক যাচাই করা হচ্ছে ও ভিডিও প্রসেস হচ্ছে...*', { parse_mode: 'Markdown' });

    try {
        // 🛠️ ফ্রি Cobalt API ব্যবহার করে সোশ্যাল ভিডিওর মেইন ডাইরেক্ট MP4 লিংক বের করা
        const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: videoLink })
        });
        const cobaltData = await cobaltRes.json();

        if (cobaltData.status === 'stream' || cobaltData.status === 'picker' || cobaltData.url) {
            const directMp4Url = cobaltData.url || cobaltData.picker[0].url;

            await ctx.deleteMessage(waitMsg.message_id).catch(() => {});

            // ইউজারকে মেইন ভিডিওটি পাঠানো এবং সাথে কনভার্ট করার ২টা ইনলাইন বাটন দেওয়া
            await ctx.replyWithVideo(
                { url: directMp4Url },
                {
                    caption: `🎬 *আপনার ভিডিওটি সফলভাবে ডাউনলোড হয়েছে!*`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🎵 Convert to MP3 (Audio)', callback_data: `aud|${directMp4Url}` },
                                { text: '📱 Convert to 3GP (144p)', callback_data: `3gp|${directMp4Url}` }
                            ]
                        ]
                    }
                }
            );
        } else {
            throw new Error("Could not fetch video URL");
        }
    } catch (error) {
        await ctx.deleteMessage(waitMsg.message_id).catch(() => {});
        ctx.reply('❌ ভিডিওটি ডাউনলোড করতে সমস্যা হয়েছে। লিংকটি আবার চেক করুন বা কিছুক্ষণ পর চেষ্টা করুন।');
    }
});

// ==========================================
// 🔥 BUTTON ACTIONS (CONVERSION) 🔥
// ==========================================
bot.action(/^aud\|(.+)$/, async (ctx) => {
    const directUrl = ctx.match[1];
    ctx.answerCbQuery('অডিও কনভার্ট শুরু হচ্ছে...').catch(() => {});
    const progressMsg = await ctx.reply('⏳ *ভিডিও থেকে MP3 অডিও তৈরি করা হচ্ছে...* \nइसमें ১-২ মিনিট সময় লাগতে পারে।', { parse_mode: 'Markdown' });

    try {
        const mp3Url = await convertMedia(directUrl, 'mp3');
        await ctx.deleteMessage(progressMsg.message_id).catch(() => {});
        await ctx.replyWithAudio({ url: mp3Url }, { caption: '🎵 *আপনার অডিও ফাইল রেডি!*' });
    } catch (e) {
        await ctx.deleteMessage(progressMsg.message_id).catch(() => {});
        ctx.reply('❌ অ디오 কনভার্ট করতে সমস্যা হয়েছে। FreeConvert-এর ফ্রি লিমিট শেষ হয়ে থাকতে পারে।');
    }
});

bot.action(/^3gp\|(.+)$/, async (ctx) => {
    const directUrl = ctx.match[1];
    ctx.answerCbQuery('3GP কনভার্ট শুরু হচ্ছে...').catch(() => {});
    const progressMsg = await ctx.reply('⏳ *বাটন ফোনের জন্য 144p 3GP ফরম্যাটে কনভার্ট করা হচ্ছে...*\nদয়া করে অপেক্ষা করুন।', { parse_mode: 'Markdown' });

    try {
        const gpUrl = await convertMedia(directUrl, '3gp');
        await ctx.deleteMessage(progressMsg.message_id).catch(() => {});
        await ctx.replyWithDocument({ url: gpUrl, filename: 'button_phone_144p.3gp' }, { caption: '📱 *আপনার 3GP ভিডিও রেডি!*\nএখন এটি বাটন ফোনে খুব সহজে চলবে।' });
    } catch (e) {
        await ctx.deleteMessage(progressMsg.message_id).catch(() => {});
        ctx.reply('❌ 3GP কনভার্ট করতে ব্যর্থ হয়েছে।');
    }
});

// Vercel Server Handler
module.exports = async function handler(req, res) {
    if (req.method === 'POST') {
        try { 
            await bot.handleUpdate(req.body); 
            res.status(200).send('OK'); 
        } catch (error) { 
            res.status(500).send('Error'); 
        }
    } else { 
        res.status(200).send('Media Downloader & Converter Bot is Live!'); 
    }
};
