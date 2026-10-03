import { useState, useEffect, useRef, useCallback } from "react";
import { socket } from "../config/socket";
import toast from "react-hot-toast";
import { useAuth } from "@clerk/react";

// WebRTC ICE servers configuration.
// NOTE: Only public Google STUN servers are configured below. STUN discovers public IP/ports,
// but restrictive networks (symmetric NAT, corporate firewalls) require a TURN relay server.
// For production-grade connectivity across all networks, configure a TURN server (e.g. Twilio, Coturn, Metered).
const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
    ],
};

// TECHNICAL TODO (Screen Sharing):
// Screen sharing is currently not implemented in this application.
// To add screen sharing in the future, invoke `navigator.mediaDevices.getDisplayMedia({ video: true })`
// and replace the video track on each active RTCPeerConnection using `RTCRtpSender.replaceTrack()`.

// TECHNICAL TODO (Production Scalability / SFU Architecture):
// This application uses peer-to-peer full-mesh WebRTC (every participant connects to every other participant).
// Full mesh is practical only for small groups (~4-6 peers). Supporting 100 simultaneous participants in production
// requires transitioning from full mesh to a Selective Forwarding Unit (SFU) architecture (e.g. LiveKit, mediasoup, Janus).

export const useWebRTC = (roomId, user, onMeetingEnded, enabled = true) => {
    const { getToken } = useAuth();
    const [localStream, setLocalStream] = useState(null);
    const [remoteUsers, setRemoteUsers] = useState([]); // Array of { socketId, userId, userName, stream, audioEnabled, videoEnabled }
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);

    const peersRef = useRef(new Map()); // socketId -> RTCPeerConnection
    const localStreamRef = useRef(null);

    // Initialize local media stream
    const initLocalStream = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
            localStreamRef.current = stream;
            setLocalStream(stream);
            setVideoEnabled(true);
            setAudioEnabled(true);
            return stream;
        } catch (error) {
            console.error("Media devices access error:", error);
            // Fallback: try audio only
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localStreamRef.current = audioStream;
                setLocalStream(audioStream);
                setVideoEnabled(false);
                setAudioEnabled(true);
                return audioStream;
            } catch (err) {
                console.error("Audio-only fallback error:", err);
                localStreamRef.current = null;
                setLocalStream(null);
                setVideoEnabled(false);
                setAudioEnabled(false);
                return null;
            }
        }
    }, []);

    // Create RTCPeerConnection for a target socket
    const createPeerConnection = useCallback((targetSocketId, targetUser) => {
        if (peersRef.current.has(targetSocketId)) {
            return peersRef.current.get(targetSocketId);
        }

        const peer = new RTCPeerConnection(ICE_SERVERS);

        // Add local tracks to peer connection
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
                peer.addTrack(track, localStreamRef.current);
            });
        }

        // Handle ICE candidates
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("ice-candidate", {
                    targetSocketId,
                    senderSocketId: socket.id,
                    candidate: event.candidate,
                });
            }
        };

        // Handle incoming remote stream tracks
        peer.ontrack = (event) => {
            const remoteStream = event.streams[0];
            setRemoteUsers((prev) => {
                const existingIndex = prev.findIndex((u) => u.socketId === targetSocketId);
                if (existingIndex > -1) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                        ...updated[existingIndex],
                        stream: remoteStream,
                    };
                    return updated;
                } else {
                    return [
                        ...prev,
                        {
                            socketId: targetSocketId,
                            userId: targetUser?.userId,
                            userName: targetUser?.userName || "Participant",
                            stream: remoteStream,
                            audioEnabled: targetUser?.audioEnabled ?? true,
                            videoEnabled: targetUser?.videoEnabled ?? true,
                        },
                    ];
                }
            });
        };

        peersRef.current.set(targetSocketId, peer);
        return peer;
    }, []);

    // Main WebRTC & Socket signaling setup effect
    useEffect(() => {
        if (!roomId || !user || !enabled) return;

        let isMounted = true;

        const startSession = async () => {
            const stream = await initLocalStream();

            if (!isMounted) return;

            try {
                const token = await getToken();
                if (token) {
                    socket.auth = { token };
                }
            } catch (authErr) {
                console.warn("Failed to get Clerk session token for socket:", authErr);
            }

            if (!socket.connected) {
                socket.connect();
            }

            // Emit join room (server derives user identity strictly from authenticated token)
            socket.emit("join-room", {
                roomId,
                user,
                audioEnabled: true,
                videoEnabled: true,
            });

            // 1. Receive all existing users in room
            socket.on("all-users", (existingUsers) => {
                existingUsers.forEach((existingUser) => {
                    const peer = createPeerConnection(existingUser.socketId, existingUser);

                    // Create offer to existing user
                    peer.createOffer()
                        .then((offer) => peer.setLocalDescription(offer))
                        .then(() => {
                            socket.emit("offer", {
                                targetSocketId: existingUser.socketId,
                                callerSocketId: socket.id,
                                sdp: peer.localDescription,
                            });
                        })
                        .catch((err) => console.error("Error creating offer:", err));
                });
            });

            // 2. Someone new joined -> add to state
            socket.on("user-joined", (newUser) => {
                toast(`${newUser.userName} joined the meeting`, { icon: "👋" });
                createPeerConnection(newUser.socketId, newUser);
            });

            // 3. Receive offer from caller
            socket.on("offer", async ({ callerSocketId, sdp, callerUser }) => {
                const peer = createPeerConnection(callerSocketId, callerUser);
                try {
                    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);

                    socket.emit("answer", {
                        targetSocketId: callerSocketId,
                        responderSocketId: socket.id,
                        sdp: peer.localDescription,
                    });
                } catch (err) {
                    console.error("Error handling offer:", err);
                }
            });

            // 4. Receive answer from responder
            socket.on("answer", async ({ responderSocketId, sdp }) => {
                const peer = peersRef.current.get(responderSocketId);
                if (peer) {
                    try {
                        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                    } catch (err) {
                        console.error("Error setting remote description from answer:", err);
                    }
                }
            });

            // 5. Receive ICE candidate
            socket.on("ice-candidate", async ({ senderSocketId, candidate }) => {
                const peer = peersRef.current.get(senderSocketId);
                if (peer && candidate) {
                    try {
                        await peer.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (err) {
                        console.error("Error adding ICE candidate:", err);
                    }
                }
            });

            // 6. Handle peer audio toggle
            socket.on("user-toggled-audio", ({ socketId, audioEnabled }) => {
                setRemoteUsers((prev) => prev.map((u) => (u.socketId === socketId ? { ...u, audioEnabled } : u)));
            });

            // 7. Handle peer video toggle
            socket.on("user-toggled-video", ({ socketId, videoEnabled }) => {
                setRemoteUsers((prev) => prev.map((u) => (u.socketId === socketId ? { ...u, videoEnabled } : u)));
            });

            // 8. Handle peer left
            socket.on("user-left", ({ socketId, user: leftUser }) => {
                if (leftUser) {
                    toast(`${leftUser.userName} left the meeting`);
                }
                const peer = peersRef.current.get(socketId);
                if (peer) {
                    peer.close();
                    peersRef.current.delete(socketId);
                }
                setRemoteUsers((prev) => prev.filter((u) => u.socketId !== socketId));
            });

            // 9. Handle meeting ended by host
            socket.on("meeting-ended", ({ message }) => {
                toast.error(message || "This meeting has ended");
                if (onMeetingEnded) {
                    onMeetingEnded(message);
                }
            });
        };

        startSession();

        // Cleanup on leave/unmount
        return () => {
            isMounted = false;

            // Stop local tracks
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => track.stop());
            }

            // Close all peer connections
            peersRef.current.forEach((peer) => peer.close());
            peersRef.current.clear();

            // Off socket listeners
            socket.off("all-users");
            socket.off("user-joined");
            socket.off("offer");
            socket.off("answer");
            socket.off("ice-candidate");
            socket.off("user-toggled-audio");
            socket.off("user-toggled-video");
            socket.off("user-left");
            socket.off("meeting-ended");

            socket.disconnect();
        };
    }, [roomId, user?.id, enabled, createPeerConnection, initLocalStream, onMeetingEnded]);

    // Toggle local mic
    const toggleAudio = async () => {
        const audioTrack = localStreamRef.current?.getAudioTracks?.()[0];
        if (audioTrack) {
            const newState = !audioEnabled;
            audioTrack.enabled = newState;
            setAudioEnabled(newState);
            socket.emit("toggle-audio", { roomId, audioEnabled: newState });
            return;
        }

        // No audio track yet, try requesting microphone
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!localStreamRef.current) {
                localStreamRef.current = stream;
                setLocalStream(stream);
            } else {
                stream.getAudioTracks().forEach(t => localStreamRef.current.addTrack(t));
                setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
            }
            peersRef.current.forEach((peer) => {
                stream.getAudioTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));
            });
            setAudioEnabled(true);
            socket.emit("toggle-audio", { roomId, audioEnabled: true });
            toast.success("Microphone enabled!");
        } catch (err) {
            console.error("Microphone access error:", err);
            if (err.name === "NotAllowedError") {
                toast.error("Microphone blocked. Click the lock icon 🔒 in the browser address bar to Allow it!", { id: "mic-blocked", duration: 4000 });
            } else if (err.name === "NotFoundError") {
                toast.error("No microphone device found on your system.", { id: "no-mic", duration: 4000 });
            } else {
                toast.error("Could not access microphone.");
            }
            // Toggle UI state so button reacts
            setAudioEnabled(prev => !prev);
            socket.emit("toggle-audio", { roomId, audioEnabled: !audioEnabled });
        }
    };

    // Toggle local camera
    const toggleVideo = async () => {
        const videoTrack = localStreamRef.current?.getVideoTracks?.()[0];
        if (videoTrack) {
            const newState = !videoEnabled;
            videoTrack.enabled = newState;
            setVideoEnabled(newState);
            socket.emit("toggle-video", { roomId, videoEnabled: newState });
            return;
        }

        // No video track yet, try requesting camera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (!localStreamRef.current) {
                localStreamRef.current = stream;
                setLocalStream(stream);
            } else {
                stream.getVideoTracks().forEach(t => localStreamRef.current.addTrack(t));
                setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
            }
            peersRef.current.forEach((peer) => {
                stream.getVideoTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));
            });
            setVideoEnabled(true);
            socket.emit("toggle-video", { roomId, videoEnabled: true });
            toast.success("Camera enabled!");
        } catch (err) {
            console.error("Camera access error:", err);
            if (err.name === "NotAllowedError") {
                toast.error("Camera blocked. Click the lock icon 🔒 in the browser address bar to Allow it!", { id: "cam-blocked", duration: 4000 });
            } else if (err.name === "NotFoundError") {
                toast.error("No camera found on your system.", { id: "no-cam", duration: 4000 });
            } else {
                toast.error("Could not access camera.");
            }
            // Toggle UI state so button reacts
            setVideoEnabled(prev => !prev);
            socket.emit("toggle-video", { roomId, videoEnabled: !videoEnabled });
        }
    };

    // End meeting for everyone (Host action)
    const endMeeting = useCallback(() => {
        if (roomId) {
            socket.emit("end-meeting", { roomId });
        }
    }, [roomId]);

    return {
        localStream,
        remoteUsers,
        audioEnabled,
        videoEnabled,
        toggleAudio,
        toggleVideo,
        endMeeting,
    };
};
