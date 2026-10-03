import { verifyToken, clerkClient } from "@clerk/express";
import { sql } from "./config/db.js";

// Socket.IO Room State: roomId -> Map<socketId, participantObject>
const rooms = new Map();

export function setupSocketIO(io) {
    // -------------------------------------------------------------------------
    // Phase 5: Socket.IO Authentication Middleware with Clerk
    // Verifies Clerk session JWT from handshake auth before connection is accepted.
    // -------------------------------------------------------------------------
    io.use(async (socket, next) => {
        try {
            const token =
                socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

            if (!token) {
                return next(new Error("Authentication error: Missing Clerk session token"));
            }

            const decoded = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY,
            });

            const userId = decoded?.sub;
            if (!userId) {
                return next(new Error("Authentication error: Invalid token subject"));
            }

            // Derive authoritative identity from DB or Clerk API
            let userName = "User";
            let plan = "free";

            const dbUsers = await sql`SELECT name, plan FROM users WHERE id = ${userId}`;
            if (dbUsers.length > 0) {
                userName = dbUsers[0].name || "User";
                plan = dbUsers[0].plan || "free";
            } else {
                try {
                    const clerkUser = await clerkClient.users.getUser(userId);
                    userName =
                        [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
                        "User";
                } catch (userErr) {
                    console.warn(`Could not fetch Clerk user details for ${userId}:`, userErr.message);
                }
            }

            // Attach authoritative authenticated identity to socket
            socket.user = {
                id: userId,
                name: userName,
                plan,
            };

            next();
        } catch (err) {
            console.error("Socket.IO authentication failure:", err.message);
            return next(new Error(`Authentication error: ${err.message}`));
        }
    });

    io.on("connection", (socket) => {
        let currentRoomId = null;
        let currentUser = null;

        // ---------------------------------------------------------------------
        // Phase 6: Join Meeting Room
        // Server derives identity solely from socket.user (never client payload)
        // ---------------------------------------------------------------------
        socket.on("join-room", async ({ roomId, audioEnabled = true, videoEnabled = true }) => {
            try {
                if (!roomId) {
                    socket.emit("meeting-ended", { message: "Invalid room identifier." });
                    return;
                }

                // Verify meeting status from DB
                const meetings = await sql`SELECT * FROM meetings WHERE meeting_id = ${roomId}`;

                if (meetings.length === 0) {
                    socket.emit("meeting-ended", { message: "Meeting not found." });
                    return;
                }
                const meeting = meetings[0];

                if (meeting.status === "ended") {
                    socket.emit("meeting-ended", { message: "This meeting has already ended." });
                    return;
                }

                currentRoomId = roomId;

                // Host status verified against database host_id
                const isHost =
                    Boolean(meeting.host_id && socket.user?.id) &&
                    meeting.host_id.toString() === socket.user.id.toString();

                currentUser = {
                    socketId: socket.id,
                    userId: socket.user.id,
                    userName: socket.user.name,
                    isHost,
                    audioEnabled: Boolean(audioEnabled),
                    videoEnabled: Boolean(videoEnabled),
                };

                if (!rooms.has(roomId)) {
                    rooms.set(roomId, new Map());
                }

                const roomParticipants = rooms.get(roomId);

                // Fetch host plan to enforce participant limits (10 for Free, 100 for Premium)
                const hosts = await sql`SELECT plan FROM users WHERE id = ${meeting.host_id}`;
                const hostPlan = hosts[0]?.plan || "free";
                const maxParticipants = hostPlan === "premium" ? 100 : 10;

                if (roomParticipants.size >= maxParticipants) {
                    socket.emit("meeting-ended", {
                        message: `Meeting capacity limit reached (max ${maxParticipants} participants for ${hostPlan.toUpperCase()} plan). Host must upgrade to Premium for up to 100 participants!`,
                    });
                    return;
                }

                socket.join(roomId);

                // Get existing participants in the room
                const existingUsers = Array.from(roomParticipants.values());

                // Add new participant to room socket state
                roomParticipants.set(socket.id, currentUser);

                // Phase 9: Record participant join in DB if no active session exists
                const existingParticipants = await sql`
                    SELECT id FROM meeting_participants
                    WHERE meeting_id = ${meeting.id}
                      AND user_id = ${socket.user.id}
                      AND left_at IS NULL
                    ORDER BY joined_at DESC LIMIT 1
                `;

                if (existingParticipants.length === 0) {
                    await sql`
                        INSERT INTO meeting_participants (meeting_id, user_id, name, joined_at)
                        VALUES (${meeting.id}, ${socket.user.id}, ${currentUser.userName}, NOW())
                    `;
                }

                // Send list of existing users to the newcomer
                socket.emit("all-users", existingUsers);

                // Notify everyone else in the room
                socket.to(roomId).emit("user-joined", currentUser);
            } catch (err) {
                console.error("Error joining room in socket:", err);
                socket.emit("meeting-ended", { message: "Failed to join room." });
            }
        });

        // ---------------------------------------------------------------------
        // WebRTC Signaling: Offer
        // Enforce room authorization and bind caller identity to socket.id / currentUser
        // ---------------------------------------------------------------------
        socket.on("offer", ({ targetSocketId, sdp }) => {
            if (!currentRoomId || !rooms.has(currentRoomId)) return;
            const roomParticipants = rooms.get(currentRoomId);
            if (!roomParticipants.has(targetSocketId)) return;

            io.to(targetSocketId).emit("offer", {
                callerSocketId: socket.id,
                sdp,
                callerUser: currentUser,
            });
        });

        // ---------------------------------------------------------------------
        // WebRTC Signaling: Answer
        // Enforce room authorization and bind responder identity to socket.id
        // ---------------------------------------------------------------------
        socket.on("answer", ({ targetSocketId, sdp }) => {
            if (!currentRoomId || !rooms.has(currentRoomId)) return;
            const roomParticipants = rooms.get(currentRoomId);
            if (!roomParticipants.has(targetSocketId)) return;

            io.to(targetSocketId).emit("answer", {
                responderSocketId: socket.id,
                sdp,
            });
        });

        // ---------------------------------------------------------------------
        // WebRTC Signaling: ICE Candidate
        // Enforce room authorization and bind sender identity to socket.id
        // ---------------------------------------------------------------------
        socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
            if (!currentRoomId || !rooms.has(currentRoomId)) return;
            const roomParticipants = rooms.get(currentRoomId);
            if (!roomParticipants.has(targetSocketId)) return;

            io.to(targetSocketId).emit("ice-candidate", {
                senderSocketId: socket.id,
                candidate,
            });
        });

        // Audio toggle event
        socket.on("toggle-audio", ({ roomId, audioEnabled }) => {
            const roomKey = roomId || currentRoomId;
            if (roomKey && rooms.has(roomKey) && rooms.get(roomKey).has(socket.id)) {
                rooms.get(roomKey).get(socket.id).audioEnabled = audioEnabled;
                socket.to(roomKey).emit("user-toggled-audio", {
                    socketId: socket.id,
                    audioEnabled,
                });
            }
        });

        // Video toggle event
        socket.on("toggle-video", ({ roomId, videoEnabled }) => {
            const roomKey = roomId || currentRoomId;
            if (roomKey && rooms.has(roomKey) && rooms.get(roomKey).has(socket.id)) {
                rooms.get(roomKey).get(socket.id).videoEnabled = videoEnabled;
                socket.to(roomKey).emit("user-toggled-video", {
                    socketId: socket.id,
                    videoEnabled,
                });
            }
        });

        // ---------------------------------------------------------------------
        // Phase 6: In-Meeting Chat Messages
        // Sender identity comes strictly from authenticated socket.user
        // ---------------------------------------------------------------------
        socket.on("send-message", async ({ roomId, message }) => {
            try {
                const targetRoom = roomId || currentRoomId;
                if (!targetRoom || targetRoom !== currentRoomId) return;

                const text =
                    typeof message === "string" ? message.trim() : (message?.text || "").trim();
                if (!text) return;

                const meetings = await sql`SELECT id, status FROM meetings WHERE meeting_id = ${targetRoom}`;

                if (meetings.length > 0 && meetings[0].status !== "ended") {
                    const meetingId = meetings[0].id;
                    const senderId = socket.user.id;
                    const senderName = socket.user.name;

                    const [insertedMsg] = await sql`
                        INSERT INTO meeting_messages (meeting_id, sender_id, sender_name, text, timestamp)
                        VALUES (${meetingId}, ${senderId}, ${senderName}, ${text}, NOW())
                        RETURNING id, timestamp
                    `;

                    io.in(targetRoom).emit("receive-message", {
                        id: insertedMsg.id.toString(),
                        text,
                        senderId,
                        senderName,
                        senderSocketId: socket.id,
                        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        timestamp: insertedMsg.timestamp,
                    });
                }
            } catch (err) {
                console.error("Error saving chat message to DB:", err);
            }
        });

        // ---------------------------------------------------------------------
        // Phase 6: Host Explicitly Ends Meeting
        // Strict DB verification: Only the actual meeting owner in DB can end meeting
        // ---------------------------------------------------------------------
        socket.on("end-meeting", async ({ roomId }) => {
            try {
                const targetRoom = roomId || currentRoomId;
                if (!targetRoom) return;

                const meetings = await sql`SELECT id, host_id, status FROM meetings WHERE meeting_id = ${targetRoom}`;
                if (meetings.length === 0) {
                    socket.emit("error-message", { message: "Meeting not found." });
                    return;
                }

                const meeting = meetings[0];

                // Verify that authenticated user is indeed the meeting host in DB
                if (meeting.host_id.toString() !== socket.user.id.toString()) {
                    console.warn(
                        `Unauthorized attempt to end meeting ${targetRoom} by user ${socket.user.id}`
                    );
                    socket.emit("error-message", {
                        message: "Unauthorized: Only the meeting host can end this meeting.",
                    });
                    return;
                }

                // Mark meeting as ended in DB
                await sql`
                    UPDATE meetings
                    SET status = 'ended', ended_at = NOW()
                    WHERE id = ${meeting.id}
                `;

                // Phase 9: Update left_at for all remaining active participants
                await sql`
                    UPDATE meeting_participants
                    SET left_at = NOW()
                    WHERE meeting_id = ${meeting.id} AND left_at IS NULL
                `;

                io.to(targetRoom).emit("meeting-ended", {
                    message: "The meeting has been ended by the host.",
                });
                rooms.delete(targetRoom);
            } catch (err) {
                console.error("Error ending meeting:", err);
            }
        });

        // ---------------------------------------------------------------------
        // Phase 9: Handle Disconnect & Record left_at Persistence
        // ---------------------------------------------------------------------
        socket.on("disconnect", async () => {
            if (currentRoomId && rooms.has(currentRoomId)) {
                const roomParticipants = rooms.get(currentRoomId);
                roomParticipants.delete(socket.id);

                try {
                    // Update leave timestamp in database for authenticated participant
                    const meetings = await sql`SELECT id FROM meetings WHERE meeting_id = ${currentRoomId}`;
                    if (meetings.length > 0 && socket.user?.id) {
                        await sql`
                            UPDATE meeting_participants
                            SET left_at = NOW()
                            WHERE meeting_id = ${meetings[0].id}
                              AND user_id = ${socket.user.id}
                              AND left_at IS NULL
                        `;
                    }
                } catch (dbErr) {
                    console.error("Error updating participant left_at on disconnect:", dbErr);
                }

                if (roomParticipants.size === 0) {
                    rooms.delete(currentRoomId);
                } else {
                    // Notify remaining peers that a user disconnected
                    socket.to(currentRoomId).emit("user-left", {
                        socketId: socket.id,
                        user: currentUser,
                    });
                }
            }
        });
    });
}