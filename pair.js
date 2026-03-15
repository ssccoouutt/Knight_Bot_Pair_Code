import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import zlib from 'zlib';
import { promisify } from 'util';

const router = express.Router();
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Function to create gzip compressed base64 session string
async function createCompressedSessionString(credsPath) {
    try {
        console.log("📁 Reading creds.json from:", credsPath);
        
        // Read the creds.json file
        const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        
        // Convert to JSON string
        const jsonString = JSON.stringify(credsData);
        console.log("📝 creds.json size:", jsonString.length, "bytes");
        
        // Compress with gzip
        const compressed = await gzip(Buffer.from(jsonString));
        console.log("🗜️ Compressed size:", compressed.length, "bytes");
        
        // Convert to base64
        const base64String = compressed.toString('base64');
        console.log("🔐 Base64 length:", base64String.length);
        
        // Save as txt file in the same directory
        const txtPath = credsPath.replace('creds.json', 'session.txt');
        fs.writeFileSync(txtPath, base64String);
        console.log(`✅ Session string saved to: ${txtPath}`);
        
        return base64String;
    } catch (error) {
        console.error('❌ Error creating compressed session string:', error);
        return null;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ 
                code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' 
            });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Preparing to send session files to user...");
                    
                    try {
                        const credsPath = dirs + '/creds.json';
                        
                        // Check if creds.json exists
                        if (!fs.existsSync(credsPath)) {
                            console.error("❌ creds.json not found!");
                            return;
                        }
                        
                        const sessionKnight = fs.readFileSync(credsPath);
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        
                        // MESSAGE 1: Send creds.json file
                        console.log("📤 Sending creds.json file...");
                        await KnightBot.sendMessage(userJid, {
                            document: sessionKnight,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("✅ creds.json file sent successfully");

                        // Create compressed session string
                        console.log("🔐 Creating compressed session string...");
                        const sessionString = await createCompressedSessionString(credsPath);
                        
                        if (sessionString) {
                            // MESSAGE 2: Send session string as text
                            console.log("📤 Sending session string...");
                            
                            // Split long message if needed (WhatsApp has limits)
                            const maxLength = 4096;
                            if (sessionString.length > maxLength) {
                                // Send in parts
                                const parts = Math.ceil(sessionString.length / maxLength);
                                await KnightBot.sendMessage(userJid, {
                                    text: `🔐 *Your Compressed Session String (Part 1/${parts}):*\n\n`
                                });
                                
                                for (let i = 0; i < parts; i++) {
                                    const start = i * maxLength;
                                    const end = Math.min(start + maxLength, sessionString.length);
                                    const part = sessionString.substring(start, end);
                                    
                                    await KnightBot.sendMessage(userJid, {
                                        text: `\`\`\`${part}\`\`\``
                                    });
                                }
                                
                                await KnightBot.sendMessage(userJid, {
                                    text: `✅ *Session string sent in ${parts} parts*\n📁 Also saved as session.txt on server`
                                });
                            } else {
                                // Send as single message
                                await KnightBot.sendMessage(userJid, {
                                    text: `🔐 *Your Compressed Session String:*\n\n\`\`\`${sessionString}\`\`\`\n\n📁 *Also saved as session.txt on server*\n\n✅ *Use this in your bot's SESSION_ID config variable*`
                                });
                            }
                            console.log("✅ Session string sent successfully");
                        }

                        // MESSAGE 3: Send video thumbnail with caption
                        console.log("📤 Sending video guide...");
                        await KnightBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/NjOipI2AoMk`
                        });
                        console.log("✅ Video guide sent successfully");

                        // MESSAGE 4: Send warning message
                        console.log("📤 Sending warning message...");
                        await KnightBot.sendMessage(userJid, {
                            text: `⚠️ *DO NOT SHARE THESE FILES WITH ANYBODY* ⚠️

┌─────────────────┈ ⳹
│✑  *KNIGHT BOT SESSION*
├─────────────────┈ ⳹
│✅ *Files sent successfully!*
│
│📁 *Files saved on server:* 
│  • creds.json (original)
│  • session.txt (compressed base64)
│
│🔐 *Session string sent above*
│
│⚠️ *Warning:*
│• Keep these files secure
│• Don't share with anyone
│• Use session string in config.js
│
│©2025 Mr Unique Hacker
└─────────────────┈ ⳹

📱 *Your number:* +${num}
🔐 *Session files preserved - NOT deleted*`
                        });
                        console.log("✅ Warning message sent successfully");

                        console.log("\n" + "=".repeat(50));
                        console.log("🎉 ALL MESSAGES SENT SUCCESSFULLY!");
                        console.log("=".repeat(50));
                        console.log(`📁 Session directory: ${dirs}`);
                        console.log(`📄 Files preserved:`);
                        console.log(`   - ${dirs}/creds.json`);
                        console.log(`   - ${dirs}/session.txt`);
                        console.log("=".repeat(50));
                        
                        // FILES ARE PRESERVED - NOT DELETED
                        
                    } catch (error) {
                        console.error("❌ Error in message sending:", error);
                        
                        // Try to send error notification to user
                        try {
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            await KnightBot.sendMessage(userJid, {
                                text: `❌ *Error occurred while sending files*\n\nPlease try again or contact support.\n\nError: ${error.message}`
                            });
                        } catch (e) {
                            console.error("❌ Could not send error message to user:", e);
                        }
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log("🔁 Connection closed");

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Session invalid.");
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(3000); // Wait 3 seconds before requesting pairing code
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    console.log(`📱 Requesting pair code for number: ${num}`);
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    if (!res.headersSent) {
                        console.log("✅ Pair code generated:", { num, code });
                        await res.send({ 
                            success: true,
                            number: num,
                            code: code,
                            message: "Enter this code in WhatsApp > Linked Devices"
                        });
                    }
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ 
                            success: false,
                            code: 'Failed to get pairing code. Please check your phone number and try again.' 
                        });
                    }
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ 
                    success: false,
                    code: 'Service Unavailable' 
                });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    
    // Ignore common Baileys errors
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    
    // Log other unexpected errors
    console.log('⚠️ Caught exception:', err.message);
});

export default router;
