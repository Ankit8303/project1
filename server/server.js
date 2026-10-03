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
await initDB()

const allowedOrigins = process.env.ORIGINS
    ? process.env.ORIGINS.split(",")
    : ["http://localhost:5173", "http://localhost:3000"];

const corsOriginValidator = (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        (process.env.VERCEL_URL && origin.includes(process.env.VERCEL_URL))
    ) {
        return callback(null, true);
    }
    return callback(null, true);
};

app.use(cors({ origin: corsOriginValidator, credentials: true }));
app.use(cookieParser());


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

server.listen(port, ()=>{
    console.log(`Server is running at http://localhost:${port}`);
})

export default app;