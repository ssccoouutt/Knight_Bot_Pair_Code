import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import zlib from 'zlib';

const router = express.Router();

// Store active sessions to keep them alive
const activeSessions = new Map();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

function generateSessionString(credsPath) {
    try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        const jsonString = JSON.stringify(creds, null, 0);
        const compressedData = zlib.gzipSync(jsonString);
        const base64Data = compressedData.toString('base64');
        const sessionString = `KnightBot!${base64Data}`;
        const txtPath = credsPath.replace('creds.json', 'session.txt');
        fs.writeFileSync(txtPath, sessionString);
        console.log(`✅ Session string saved to: ${txtPath}`);
        return sessionString;
    } catch (error) {
        console.error('Error generating session string:', error);
        return null;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);
    
    // Check if session already exists and is active
    if (activeSessions.has(num)) {
        const session = activeSessions.get(num);
        if (session.socket && session.socket.user) {
            console.log(`✅ Using existing active session for ${num}`);
            // Session already active, just return the code
            return res.send({ code: session.code, existing: true });
        }
    }

    // Remove existing session directory
    await removeFile(dirs);

    // Clean the phone number
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK) without + or spaces.' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    let pairingCode = null;
    let pairingTimeout = null;
    let KnightBot = null;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            KnightBot = makeWASocket({
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

            // Store session in map
            activeSessions.set(num, {
                socket: KnightBot,
                dirs: dirs,
                startTime: Date.now()
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log(`✅ Connected successfully for ${num}!`);
                    
                    // Clear timeout if exists
                    if (pairingTimeout) {
                        clearTimeout(pairingTimeout);
                    }
                    
                    try {
                        const sessionKnight = fs.readFileSync(dirs + '/creds.json');
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        
                        // Send creds.json file
                        await KnightBot.sendMessage(userJid, {
                            document: sessionKnight,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log(`📄 Session file sent to ${num}`);

                        // Generate and send session string
                        const sessionString = generateSessionString(dirs + '/creds.json');
                        if (sessionString) {
                            await KnightBot.sendMessage(userJid, {
                                text: `🔐 *Your Session String:*\n\n\`\`\`${sessionString}\`\`\`\n\n_Keep this safe! Do not share with anyone._`
                            });
                            console.log(`🔐 Session string sent to ${num}`);
                        }

                        // Send video guide
                        await KnightBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/NjOipI2AoMk`
                        });
                        console.log(`🎬 Video guide sent to ${num}`);

                        // Send warning
                        await KnightBot.sendMessage(userJid, {
                            text: `⚠️ Do not share this file with anybody ⚠️\n 
┌┤✑  Thanks for using Knight Bot
│└────────────┈ ⳹        
│©2025 Mr Unique Hacker 
└─────────────────┈ ⳹\n\n`
                        });
                        console.log(`⚠️ Warning message sent to ${num}`);
                        
                        // Keep session alive for 2 minutes after completion
                        setTimeout(() => {
                            if (activeSessions.has(num)) {
                                console.log(`🧹 Cleaning up session for ${num} after 2 minutes`);
                                activeSessions.delete(num);
                                removeFile(dirs);
                            }
                        }, 120000);
                        
                    } catch (error) {
                        console.error(`❌ Error sending messages to ${num}:`, error);
                    }
                }

                if (isNewLogin) {
                    console.log(`🔐 New login via pair code for ${num}`);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`🔌 Connection closed for ${num}, status: ${statusCode}`);

                    if (statusCode === 401) {
                        console.log(`❌ Logged out for ${num}. Need to generate new pair code.`);
                        activeSessions.delete(num);
                    } else {
                        // Don't auto-reconnect for pairing sessions
                        console.log(`🔁 Connection closed for ${num} - not restarting`);
                    }
                }
            });

            // Request pairing code if not registered
            if (!KnightBot.authState.creds.registered) {
                await delay(5000); // Wait 5 seconds for socket to stabilize
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    console.log(`📱 Requesting pairing code for ${num}`);
                    let code = await KnightBot.requestPairingCode(num);
                    pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`🔑 Pairing code for ${num}: ${pairingCode}`);
                    
                    // Send response immediately with the code
                    if (!res.headersSent) {
                        await res.send({ code: pairingCode });
                    }
                    
                    // Set timeout for pairing (5 minutes)
                    pairingTimeout = setTimeout(() => {
                        console.log(`⏰ Pairing timeout for ${num} - no connection established`);
                        if (KnightBot) {
                            KnightBot.end();
                        }
                        if (activeSessions.has(num)) {
                            activeSessions.delete(num);
                        }
                        removeFile(dirs);
                    }, 300000); // 5 minutes
                    
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

// Cleanup inactive sessions every minute
setInterval(() => {
    const now = Date.now();
    for (const [num, session] of activeSessions.entries()) {
        // Remove sessions older than 10 minutes
        if (now - session.startTime > 600000) {
            console.log(`🧹 Cleaning up inactive session for ${num}`);
            if (session.socket) {
                try {
                    session.socket.end();
                } catch (e) {}
            }
            removeFile(session.dirs);
            activeSessions.delete(num);
        }
    }
}, 60000);

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
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
