# Meetup - Full Stack Video Calling App

Meetup is a real-time video conferencing web application built with React, Vite, Express, Socket.IO, WebRTC, Clerk, and Neon PostgreSQL.

---

## Architecture Overview

The system consists of two decoupled services designed for independent deployment or local orchestration:

```text
┌────────────────────────────┐               ┌────────────────────────────┐
│      Client (React/Vite)   │               │   Backend (Express/Node)   │
│  - React 19 + Tailwind CSS │  HTTP/REST    │  - Express 5 REST API      │
│  - Clerk React SDK         │ ────────────> │  - Clerk Express Auth      │
│  - Socket.IO Client        │               │  - Neon Serverless PG      │
│  - WebRTC PeerConnection   │ <───────────> │  - Socket.IO Signaling     │
└────────────────────────────┘   WebSockets  └────────────────────────────┘
              │                                             │
              │              P2P Media Mesh                 │
              └─────────────────────────────────────────────┘
                     (Direct Audio/Video Streams)
```

- **Frontend (`client/`)**: Single-Page Application (SPA) built with React 19, Tailwind CSS v4, Lucide icons, and `@clerk/react`. In production, static assets are served by an Express runner (`client/server.cjs`) supporting SPA history fallback.
- **Backend (`server/`)**: Node.js HTTP server hosting Express 5 and Socket.IO. Handles REST API requests, Clerk authentication, database persistence via Neon PostgreSQL, and real-time WebRTC signaling.
- **Authentication**: User identity and session tokens are managed via Clerk. Sockets are authenticated during the handshake using Clerk session JWT verification.
- **Database**: Serverless PostgreSQL hosted on Neon, storing user profiles, meetings, participant logs, and chat transcripts.
- **Real-Time Communication**: Socket.IO is used for signaling, room state synchronization, and in-meeting chat. Media streams are transmitted peer-to-peer using WebRTC.

---

## What Is Actually Implemented

- 📹 **Peer-to-Peer Audio & Video**: Full-mesh WebRTC conferencing with dynamic camera and microphone toggles, participant avatars, and media permission error handling.
- 💬 **In-Meeting Chat**: Real-time messaging persisted to Neon PostgreSQL with author identity cryptographically verified on the server.
- 🔒 **Server-Side Authorization**: Only verified meeting owners can end meetings. Participants cannot spoof identity or inject arbitrary sender IDs.
- 👥 **Meeting History & Session Logs**: Tracks active and past sessions with join and leave timestamps for every participant.
- 🩺 **Health Check Endpoints**: Public `GET /health` endpoints on both frontend and backend services for deployment orchestrators and uptime monitors.

---

## WebRTC Capabilities & Known Technical Limitations

### 1. Screen Sharing (Not Implemented)
`navigator.mediaDevices.getDisplayMedia` is **not currently implemented**. Screen sharing is not supported in this release. An explicit technical TODO is documented in `client/src/hooks/useWebRTC.js` outlining the required track replacement mechanism (`RTCRtpSender.replaceTrack`).

### 2. NAT Traversal & TURN Requirement
The application is configured with Google's public STUN servers (`stun:stun.l.google.com:19302`). STUN allows clients to discover their public IP and port across standard NATs.
> [!IMPORTANT]
> **TURN servers are NOT currently configured.** Clients behind restrictive symmetric NATs, cellular carrier-grade NATs, or strict corporate firewalls may fail to establish direct P2P connections. For production-grade connectivity in all network environments, a TURN relay service (such as Twilio Network Traversal, Coturn, or Metered) must be added to `ICE_SERVERS`.

### 3. Full-Mesh Architecture & Scalability Limit
The application uses a **peer-to-peer full-mesh topology** where every participant creates an independent `RTCPeerConnection` to every other participant:
- Connections required: $N \times (N - 1) / 2$
- Upstream media encodings per participant: $N - 1$

| Participants ($N$) | Total Mesh Connections | Upstream Video Streams per Client |
|--------------------|------------------------|-----------------------------------|
| 2                  | 1                      | 1                                 |
| 4                  | 6                      | 3                                 |
| 10 (Free Plan)     | 45                     | 9 (Practical mesh limit)          |
| 100 (Premium Plan) | 4,950                  | 99 (Will crash browser/network)   |

> [!WARNING]
> While the business tier logic allows host plans up to 100 participants, a **full-mesh architecture cannot support 100 simultaneous participants**. Scaling beyond 4–6 peers requires transitioning to a **Selective Forwarding Unit (SFU)** architecture (e.g., LiveKit, mediasoup, or Janus) where each client publishes a single stream and receives forwarded streams from a media router.

---

## Health Endpoint

- **Backend Health Check**:
  ```http
  GET /health
  ```
  Returns HTTP 200:
  ```json
  {
    "status": "ok",
    "service": "meetup-backend",
    "timestamp": "2026-10-03T11:25:00.000Z"
  }
  ```
  *Does not require Clerk authentication. Available publicly for Railway deployment health checks.*

- **Frontend Health Check**:
  ```http
  GET /health
  ```
  Returns HTTP 200:
  ```json
  {
    "status": "ok",
    "service": "meetup-frontend"
  }
  ```

---

## Environment Variables

### Backend (`server/.env`)
| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Port to listen on (Railway assigns dynamically; defaults to `3000`) |
| `NODE_ENV` | Yes | Set to `production` in production |
| `ORIGINS` | Yes | Comma-separated allowlist of allowed frontend origins (e.g. `https://meetup-frontend.up.railway.app`) |
| `DATABASE_URL` | Yes | Neon PostgreSQL pooled connection URI |
| `CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (`pk_...`) |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key (`sk_...`) |
| `CLERK_WEBHOOK_SIGNING_SECRET`| Yes | Signing secret for verifying Clerk webhooks at `/api/clerk` |

### Frontend (`client/.env`)
| Variable | Required | Description |
|---|---|---|
| `VITE_BASE_URL` | Yes | Full URL of the backend service (e.g. `https://meetup-backend.up.railway.app`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (`pk_...`) |

---

## Local Development

### Prerequisites
- Node.js >= 20.9.0
- Active Neon PostgreSQL instance
- Active Clerk project

### 1. Start Backend
```bash
cd server
npm install
npm run server
```
The backend starts on `http://localhost:3000`.

### 2. Start Frontend
```bash
cd client
npm install
npm run dev
```
The frontend starts on `http://localhost:5173`.

---

## Railway Deployment Guide

Railway can host both frontend and backend as two separate services in a single Railway project.

### 1. Deploy Backend Service
1. Create a new service from your GitHub repository in Railway.
2. Set the **Root Directory** to `server`.
3. In Railway **Variables**, configure:
   - `DATABASE_URL`: Your Neon database connection URL
   - `CLERK_PUBLISHABLE_KEY`: `pk_...`
   - `CLERK_SECRET_KEY`: `sk_...`
   - `CLERK_WEBHOOK_SIGNING_SECRET`: `whsec_...`
   - `ORIGINS`: Your frontend Railway URL (e.g., `https://frontend.up.railway.app`)
   - `NODE_ENV`: `production`
4. Set **Healthcheck Path** to `/health`.
5. Deploy. Note the generated Railway backend domain (e.g., `https://backend.up.railway.app`).

### 2. Deploy Frontend Service
1. Create a second service from the same repository in Railway.
2. Set the **Root Directory** to `client`.
3. In Railway **Variables**, configure:
   - `VITE_BASE_URL`: The backend URL from step 1 (e.g. `https://backend.up.railway.app`)
   - `VITE_CLERK_PUBLISHABLE_KEY`: `pk_...`
4. Railway will automatically run:
   - Build: `npm run build`
   - Start: `npm start` (executes `node server.cjs` bound to `0.0.0.0:$PORT`)
5. Set **Healthcheck Path** to `/health`.
6. Deploy.

---

## Legacy Vercel Configuration Note
The repository contains `vercel.json` which configured multi-service routing for Vercel. For Railway deployments, Railway uses its own containerized process runners and does not read `vercel.json`. The file is retained for backward compatibility with previous deployments.
