import express from "express";
import "dotenv/config";
import cors from "cors";
import http from "http"
import cookieParser from "cookie-parser";
import { initDB } from "./config/db.js";
import { clerkMiddleware } from '@clerk/express'
import { handleClerkWebhook } from "./controllers/webhookController.js";
import meetingRouter from "./routes/meetingRoutes.js";
import { Server } from "socket.io";
import { setupSocketIO } from "./socket.js";

const app = express();
const server = http.createServer(app)

// Connect to Neon & Initialize Tables
try {
    await initDB();
    console.log("Database initialized successfully");
} catch (dbErr) {
    console.error("Database initialization failed:", dbErr.message);
}

const defaultDevOrigins = ["http://localhost:5173", "http://localhost:3000"];

const configuredOrigins = process.env.ORIGINS
    ? process.env.ORIGINS.split(",").map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
    : [];

const corsOriginValidator = (origin, callback) => {
    // Allow requests with no Origin header (health checks, server-to-server requests, curl)
    if (!origin) {
        return callback(null, true);
    }

    const normalizedOrigin = origin.replace(/\/+$/, '');

    // Allow explicitly configured browser origins
    if (configuredOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
    }

    // In development or when no ORIGINS is set, allow default localhost dev origins
    if (process.env.NODE_ENV !== "production" && defaultDevOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
    }

    // Reject unknown browser origins
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
};

app.use(cors({ origin: corsOriginValidator, credentials: true }));
app.use(cookieParser());

// Public health endpoint (does not require Clerk authentication)
app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        service: "meetup-backend",
        timestamp: new Date().toISOString(),
    });
});

app.use("/api/clerk", express.raw({type: "application/json" }), handleClerkWebhook)
app.use(express.json())
app.use(clerkMiddleware({
    clockSkewInMs: 60000,
}))

app.get(["/", "/api"], (req, res)=> res.send("API is Live!"))
app.use("/api/meetings", meetingRouter)

const io = new Server(server, {
    cors: { origin: corsOriginValidator, credentials: true }
})

setupSocketIO(io)

// Centralized Error Handler
app.use((err, _req, res, _next)=>{
    console.error(`[Error] ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
})

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
})

export default app;