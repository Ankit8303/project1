import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");

export const socket = io(SOCKET_URL, {
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"],
    auth: async (cb) => {
        try {
            if (typeof window !== "undefined" && window.Clerk?.session) {
                const token = await window.Clerk.session.getToken();
                cb({ token });
            } else {
                cb({});
            }
        } catch {
            cb({});
        }
    },
});