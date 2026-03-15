import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Function to convert creds.json to session string and save as txt
function saveSessionString(credsPath) {
    try {
        if (!fs.existsSync(credsPath)) {
            console.log(`⚠️ creds.json not found at: ${credsPath}`);
            return null;
        }
        
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        
        // Create a session object with the necessary data
        const sessionData = {
            creds: creds,
            version: "1.0"
        };
        
        // Convert to base64 string with prefix
        const sessionString = 'KnightBot!' + Buffer.from(JSON.stringify(sessionData)).toString('base64');
        
        // Save as txt file in the same directory
        const txtPath = credsPath.replace('creds.json', 'session.txt');
        fs.writeFileSync(txtPath, sessionString);
        console.log(`✅ Session string saved to: ${txtPath}`);
        console.log(`📝 Session string (first 50 chars): ${sessionString.substring(0, 50)}...`);
        
        return sessionString;
    } catch (error) {
        console.error('Error saving session string:', error);
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
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    // FLAG to track if we've already processed this number
    let processingComplete = false;

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

                // If already processed, ignore
                if (processingComplete) return;

                if (connection === 'open') {
                    processingComplete = true;
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        const credsPath = dirs + '/creds.json';
                        
                        // Wait a bit for creds.json to be fully written
                        await delay(2000);
                        
                        const sessionKnight = fs.readFileSync(credsPath);

                        // MESSAGE 1: Send session file (creds.json)
                        await KnightBot.sendMessage(userJid, {
                            document: sessionKnight,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // MESSAGE 2: Send video thumbnail with caption
                        await KnightBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/NjOipI2AoMk`
                        });
                        console.log("🎬 Video guide sent successfully");

                        // Generate and save session string locally
                        const sessionString = saveSessionString(credsPath);

                        // MESSAGE 3: Send session string as text
                        if (sessionString) {
                            await KnightBot.sendMessage(userJid, {
                                text: `🔑 *Your Session String:*\n\n\`\`\`${sessionString}\`\`\`\n\n📝 *Save this string for future use!*`
                            });
                            console.log("🔑 Session string sent to user");
                        }

                        // MESSAGE 4: Send warning message
                        await KnightBot.sendMessage(userJid, {
                            text: `⚠️Do not share this file with anybody⚠️\n 
┌┤✑  Thanks for using Knight Bot
│└────────────┈ ⳹        
│©2025 Mr Unique Hacker 
└─────────────────┈ ⳹\n\n`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        console.log("\n📁 FILES SAVED AT: " + dirs);
                        console.log("   📄 " + credsPath);
                        console.log("   📝 " + credsPath.replace('creds.json', 'session.txt'));
                        console.log("✅ Process completed successfully!\n");
                        
                        // Close connection gracefully
                        KnightBot.end();
                        
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close' && !processingComplete) {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — will restart once");
                        // Only restart if not completed
                        if (!processingComplete) {
                            initiateSession();
                        }
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
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
    console.log('Caught exception: ', err);
});

export default router;
