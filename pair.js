import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import zlib from 'zlib';

const router = express.Router();

// Store active sessions to prevent duplicates
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

// Function to create interactive buttons with copy functionality
async function sendInteractiveMessage(sock, userJid, sessionString) {
    try {
        // Create a button template for copying session string
        const copyButton = {
            text: "📋 Copy Session String",
            callbackData: "copy_session"
        };
        
        // Send session string with copy button using Baileys native buttons
        await sock.sendMessage(userJid, {
            text: `🔐 *Your Session String:*\n\n\`\`\`${sessionString}\`\`\`\n\n_👇 Click the button below to copy_\n\n⚠️ *Keep this safe! Do not share with anyone.*`,
            buttons: [
                {
                    buttonId: 'copy_session',
                    buttonText: { displayText: '📋 Copy Session String' },
                    type: 1
                }
            ],
            viewOnce: false
        });
        
        console.log("🔐 Session string sent with copy button");
        return true;
    } catch (buttonError) {
        // Fallback: Send as normal text if buttons fail
        console.log("Buttons not supported, sending as normal text");
        await sock.sendMessage(userJid, {
            text: `🔐 *Your Session String:*\n\n\`\`\`${sessionString}\`\`\`\n\n_⚠️ Keep this safe! Do not share with anyone._`
        });
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);
    let isCompleted = false;
    let socketInstance = null;
    
    // Check if session already active for this number
    if (activeSessions.has(num)) {
        console.log(`⚠️ Session already active for ${num}, cleaning up first...`);
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

    // Remove existing session if present
    await removeFile(dirs);

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

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);
        let responseSent = false;
        let messagesSent = false;

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
                defaultQueryTimeoutMs: 30000,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 0, // Disable keep-alive
                retryRequestDelayMs: 0, // No retries
                maxRetries: 0, // No retries
                // CRITICAL: Disable auto reconnect
                shouldReconnect: () => false,
                // Disable background sync
                syncFullHistory: false,
                // Don't load any messages
                patchHistoryBefore: false
            });
            
            // Store in active sessions
            activeSessions.set(num, {
                socket: socketInstance,
                directory: dirs,
                startTime: Date.now()
            });

            // Connection update handler
            socketInstance.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log(`✅ Connected successfully for +${num}!`);
                    console.log(`📱 Sending session files to +${num}...`);
                    
                    if (!messagesSent) {
                        messagesSent = true;
                        
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

                            // Generate session string
                            const sessionString = generateSessionString(dirs + '/creds.json');
                            
                            // Send session string with copy button
                            if (sessionString) {
                                await sendInteractiveMessage(socketInstance, userJid, sessionString);
                            }

                            // Send video thumbnail
                            await socketInstance.sendMessage(userJid, {
                                image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                                caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n🚀 Bug Fixes + New Commands + Fast AI Chat\n📺 Watch Now: https://youtu.be/NjOipI2AoMk`
                            });
                            console.log("🎬 Video guide sent successfully");

                            // Send warning message
                            await socketInstance.sendMessage(userJid, {
                                text: `⚠️ *DO NOT SHARE THIS FILE WITH ANYBODY* ⚠️\n\n┌┤✑  Thanks for using Knight Bot\n│└────────────┈ ⳹        \n│©2025 Mr Unique Hacker \n└─────────────────┈ ⳹\n\n✅ *Session will now expire automatically*`
                            });
                            console.log("⚠️ Warning message sent successfully");

                            console.log(`✅ All messages sent successfully to +${num}!`);
                            
                            // CRITICAL: Force disconnect and cleanup immediately
                            console.log(`🧹 Force cleaning up session for +${num}...`);
                            
                            // Kill the connection immediately
                            if (socketInstance) {
                                try {
                                    await socketInstance.logout();
                                    await socketInstance.end(new Error("Session completed - cleanup"));
                                } catch(e) {
                                    console.log("Socket already closed");
                                }
                            }
                            
                            // Delete session files
                            await delay(1000);
                            if (!isCompleted) {
                                isCompleted = true;
                                removeFile(dirs);
                                activeSessions.delete(num);
                                console.log(`✅ Session files cleaned up for +${num}`);
                                console.log(`🎉 Process completed successfully for +${num}!`);
                                
                                // Send HTTP response if not sent yet
                                if (!res.headersSent && !responseSent) {
                                    responseSent = true;
                                    res.send({ 
                                        success: true, 
                                        message: `Session generated and sent to +${num}`,
                                        number: num
                                    });
                                }
                                
                                // Force process to be ready for next request
                                process.nextTick(() => {
                                    if (socketInstance) {
                                        try {
                                            socketInstance.ws?.close();
                                        } catch(e) {}
                                    }
                                });
                            }
                            
                        } catch (error) {
                            console.error(`❌ Error sending messages to +${num}:`, error);
                            await cleanup();
                        }
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`🔌 Connection closed for +${num} with status: ${statusCode}`);
                    
                    // Only cleanup if not already completed
                    if (!isCompleted) {
                        await cleanup();
                    }
                }
            });

            // Handle creds update
            socketInstance.ev.on('creds.update', async () => {
                await saveCreds();
            });

            // Request pairing code if not registered
            if (!socketInstance.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await socketInstance.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent && !responseSent) {
                        responseSent = true;
                        console.log(`Pairing code for +${num}: ${code}`);
                        await res.send({ code, number: num });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent && !responseSent) {
                        responseSent = true;
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                    await cleanup();
                }
            } else {
                if (!res.headersSent && !responseSent) {
                    responseSent = true;
                    res.send({ status: "Already registered, connecting..." });
                }
            }
            
            // Set timeout for cleanup (3 minutes)
            setTimeout(async () => {
                if (!isCompleted) {
                    console.log(`⚠️ Session timeout for +${num} - cleaning up...`);
                    await cleanup();
                }
            }, 180000);
            
            async function cleanup() {
                if (isCompleted) return;
                isCompleted = true;
                
                console.log(`🧹 Cleaning up session for +${num}...`);
                
                try {
                    if (socketInstance) {
                        await socketInstance.end(new Error("Cleanup"));
                    }
                } catch(e) {}
                
                await delay(1000);
                removeFile(dirs);
                activeSessions.delete(num);
                console.log(`✅ Cleanup completed for +${num}`);
                
                if (!res.headersSent && !responseSent) {
                    responseSent = true;
                    res.send({ status: "Session completed" });
                }
            }
            
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

// Auto cleanup of old sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [num, session] of activeSessions.entries()) {
        if (now - session.startTime > 3600000) { // 1 hour
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
process.on('uncaughtException', (err) => {
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
