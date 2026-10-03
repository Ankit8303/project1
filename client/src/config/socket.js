import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");

export const socket = io(SOCKET_URL, {
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"]
})