# project1

## Meetup - Full Stack Video Calling App

A modern, real-time video conferencing application built with WebRTC, React, Node.js, Express, and Socket.io.

### Features
- 📹 **Real-Time Video & Audio**: WebRTC peer-to-peer audio and video calling with screen sharing support.
- 💬 **In-Meeting Chat**: Real-time messaging with Socket.io.
- 🔒 **Authentication**: User authentication and session management powered by Clerk.
- 🗄️ **Database**: Serverless PostgreSQL powered by Neon Database.
- 🎨 **Modern UI**: Built with React 19, TailwindCSS, and Lucide icons.

---

### Project Structure
```text
meetup/
├── client/           # React frontend (Vite + TailwindCSS + WebRTC)
├── server/           # Express backend (Socket.io + Neon PostgreSQL + Clerk)
├── css/              # Shared/static assets
├── public/           # Static public assets
└── README.md         # Project documentation
```

---

### Getting Started

#### 1. Server Setup
```bash
cd server
npm install
npm run server
```

#### 2. Client Setup
```bash
cd client
npm install
npm run dev
```
