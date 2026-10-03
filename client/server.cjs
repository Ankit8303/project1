const express = require("express");
const path = require("path");

const app = express();
const distPath = path.join(__dirname, "dist");

// Serve compiled static assets
app.use(express.static(distPath));

// Health check endpoint for Railway frontend service
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "meetup-frontend" });
});

// SPA fallback: Send index.html for all routes not handled by static files
app.use((_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
    console.log(`Frontend production server running on http://0.0.0.0:${port}`);
});
