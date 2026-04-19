import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import zlib from 'zlib';

const router = express.Router();

// Store active sessions
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
    let isCompleted = false;
    let socketInstance = null;
    let responseSent = false;
    
    // Clean the phone number
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    // Check if session already exists for this number
    if (activeSessions.has(num)) {
        console.log(`⚠️ Session already active for ${num}, cleaning up...`);
        const oldSession = activeSessions.get(num);
        if (oldSession.socket) {
            try {
                await oldSession.socket.end(new Error("New session requested"));
            } catch(e) {}
        }
        if (oldSession.directory && fs.existsSync(oldSession.directory)) {
            removeFile(oldSession.directory);
        }
        activeSessions.delete(num);
    }

    // Remove existing session directory
    if (fs.existsSync(dirs)) {
        await removeFile(dirs);
    }

    async function cleanup() {
        if (isCompleted) return;
        isCompleted = true;
        
        console.log(`🧹 Cleaning up session for +${num}...`);
        
        try {
            if (socketInstance) {
                await socketInstance.logout();
                await socketInstance.end(new Error("Session completed"));
                if (socketInstance.ws) {
                    socketInstance.ws.close();
                }
            }
        } catch(e) {
            console.log("Error during cleanup:", e.message);
        }
        
        await delay(2000);
        
        if (fs.existsSync(dirs)) {
            removeFile(dirs);
        }
        
        activeSessions.delete(num);
        console.log(`✅ Cleanup completed for +${num}`);
    }

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            socketInstance = makeWASocket({
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
                maxRetries: 3,
                // Allow reconnection only during pairing process
                shouldReconnect: () => {
                    // Only reconnect if not completed
                    return !isCompleted;
                }
            });
            
            // Store in active sessions
            activeSessions.set(num, {
                socket: socketInstance,
                directory: dirs,
                startTime: Date.now()
            });

            // Handle connection updates
            socketInstance.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    console.log(`✅ Connected successfully for +${num}!`);
                    
                    // Only send messages if not already completed
                    if (!isCompleted) {
                        console.log(`📱 Sending session files to +${num}...`);
                        
                        try {
                            const sessionKnight = fs.readFileSync(dirs + '/creds.json');
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
                            // Send creds.json file
                            await socketInstance.sendMessage(userJid, {
                                document: sessionKnight,
                                mimetype: 'application/json',
                                fileName: 'creds.json'
                            });
                            console.log("📄 Session file sent successfully");

                            // Generate and send session string
                            const sessionString = generateSessionString(dirs + '/creds.json');
                            if (sessionString) {
                                await socketInstance.sendMessage(userJid, {
                                    text: `🔐 *Your Session String:*\n\n\`\`\`${sessionString}\`\`\`\n\n_Keep this safe! Do not share with anyone._`
                                });
                                console.log("🔐 Session string sent successfully");
                            }

                            // Send video thumbnail
                            await socketInstance.sendMessage(userJid, {
                                image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                                caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/NjOipI2AoMk`
                            });
                            console.log("🎬 Video guide sent successfully");

                            // Send warning message
                            await socketInstance.sendMessage(userJid, {
                                text: `⚠️ Do not share this file with anybody ⚠️\n\n┌┤✑  Thanks for using Knight Bot\n│└────────────┈ ⳹        \n│©2025 Mr Unique Hacker \n└─────────────────┈ ⳹\n\n✅ Session will be cleaned up in 5 seconds...`
                            });
                            console.log("⚠️ Warning message sent successfully");

                            console.log(`✅ All messages sent successfully to +${num}!`);
                            
                            // Wait 5 seconds then cleanup
                            setTimeout(async () => {
                                if (!isCompleted) {
                                    console.log(`🧹 Cleaning up after successful message delivery...`);
                                    await cleanup();
                                }
                            }, 5000);
                            
                        } catch (error) {
                            console.error(`❌ Error sending messages to +${num}:`, error);
                            // Still cleanup after error
                            setTimeout(async () => {
                                if (!isCompleted) {
                                    await cleanup();
                                }
                            }, 5000);
                        }
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`🔌 Connection closed for +${num} with status: ${statusCode}`);
                    
                    // Don't cleanup on close unless it's an auth error or we're completed
                    if (statusCode === 401) {
                        console.log("❌ Authentication failed - cleaning up");
                        await cleanup();
                    } else if (isCompleted) {
                        console.log("✅ Session already cleaned up");
                    } else {
                        console.log("🔄 Connection closed but waiting for pairing...");
                    }
                }
            });

            // Save creds when updated
            socketInstance.ev.on('creds.update', async () => {
                await saveCreds();
            });

            // Request pairing code if not registered
            if (!socketInstance.authState.creds.registered) {
                await delay(3000);
                let cleanNum = num.replace(/[^\d+]/g, '');
                if (cleanNum.startsWith('+')) cleanNum = cleanNum.substring(1);

                try {
                    let code = await socketInstance.requestPairingCode(cleanNum);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    if (!res.headersSent && !responseSent) {
                        responseSent = true;
                        console.log(`📱 Pairing code for +${num}: ${code}`);
                        res.send({ 
                            code: code, 
                            number: num,
                            message: "Enter this code in WhatsApp → Settings → Linked Devices → Link a Device"
                        });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent && !responseSent) {
                        responseSent = true;
                        res.status(503).send({ 
                            code: 'Failed to get pairing code. Please check your phone number and try again.' 
                        });
                    }
                    await cleanup();
                }
            } else {
                // Already has valid credentials
                if (!res.headersSent && !responseSent) {
                    responseSent = true;
                    res.send({ 
                        status: "Already registered, connecting...",
                        number: num 
                    });
                }
            }
            
            // Set a longer timeout for cleanup (10 minutes)
            // This gives user time to enter the code
            setTimeout(async () => {
                if (!isCompleted && socketInstance?.authState?.creds?.registered) {
                    console.log(`⚠️ Session timeout for +${num} - cleaning up...`);
                    await cleanup();
                } else if (!isCompleted) {
                    console.log(`⚠️ Session timeout for +${num} - no pairing completed, cleaning up...`);
                    await cleanup();
                }
            }, 600000); // 10 minutes timeout
            
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent && !responseSent) {
                responseSent = true;
                res.status(503).send({ code: 'Service Unavailable' });
            }
            await cleanup();
        }
    }

    await initiateSession();
});

// Auto cleanup old sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [num, session] of activeSessions.entries()) {
        if (now - session.startTime > 7200000) { // 2 hours
            console.log(`🧹 Auto-cleaning old session for ${num}`);
            if (session.directory && fs.existsSync(session.directory)) {
                removeFile(session.directory);
            }
            if (session.socket) {
                try {
                    session.socket.end(new Error("Auto cleanup"));
                } catch(e) {}
            }
            activeSessions.delete(num);
        }
    }
}, 3600000);

// Global uncaught exception handler
process.on('uncaughtException', (err) {
    let e = String(err);
    if (e.includes("conflict")) {
        console.log("⚠️ Conflict error ignored - session already in use");
        return;
    }
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    console.log('Caught exception: ', err);
});

export default router;
