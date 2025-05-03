import express from "express";
import http from "http";
import cors from "cors";
import bcrypt from "bcrypt";
import { Server as SocketIOServer } from "socket.io";

import pool from "./lib/database.js";
import RateLimiter from "./lib/rateLimiter.js";

// config
const ORIGINS = [
  "https://kanbany.app",
  "https://www.kanbany.app",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:3000",
];

const limiter = new RateLimiter({ windowMs: 60_000, max: 60 });
setInterval(() => limiter.cleanup(), limiter.windowMs);

const app = express();
app.use(cors({ origin: ORIGINS, methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

// tiny HTTP rate‑limit
function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress;
  if (!limiter.isAllowed(ip)) return res.status(429).json({ error: "Too many requests" });
  next();
}

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  addTrailingSlash: false,
  cors: { origin: ORIGINS, methods: ["GET", "POST"] },
});

// WebSocket rate‑limit
io.use((socket, next) => (limiter.isAllowed(socket.handshake.address) ? next() : next(new Error("RATE_LIMIT"))));

const boardUsers = new Map();

io.on("connection", (socket) => {
  let currentBoardId = null;

  socket.on("joinBoard", async ({ boardId, password }) => {
    try {
      const { rows } = await pool.query("SELECT password FROM boards WHERE id = $1", [boardId]);
      if (!rows.length) return socket.emit("joinError", "Board not found");
      const ok = rows[0].password ? await bcrypt.compare(password ?? "", rows[0].password) : true;
      if (!ok) return socket.emit("joinError", "Invalid password");
    } catch (e) {
      return socket.emit("joinError", "Server error");
    }

    if (currentBoardId) {
      socket.leave(currentBoardId);
      const set = boardUsers.get(currentBoardId);
      set?.delete(socket.id);
      io.to(currentBoardId).emit("userCount", set?.size ?? 0);
    }

    socket.join(boardId);
    currentBoardId = boardId;
    const set = boardUsers.get(boardId) ?? new Set();
    set.add(socket.id);
    boardUsers.set(boardId, set);
    io.to(boardId).emit("userCount", set.size);
  });

  socket.on("leaveBoard", () => {
    if (!currentBoardId) return;
    socket.leave(currentBoardId);
    const set = boardUsers.get(currentBoardId);
    set?.delete(socket.id);
    io.to(currentBoardId).emit("userCount", set?.size ?? 0);
    if (!set?.size) boardUsers.delete(currentBoardId);
    currentBoardId = null;
  });

  socket.on("message", (msg) => currentBoardId && io.to(currentBoardId).emit("message", msg));

  socket.on("disconnect", () => {
    if (!currentBoardId) return;
    const set = boardUsers.get(currentBoardId);
    set?.delete(socket.id);
    io.to(currentBoardId).emit("userCount", set?.size ?? 0);
    if (!set?.size) boardUsers.delete(currentBoardId);
  });
});

app.post("/push-update", rateLimit, (req, res) => {
  const { boardId, boardData, updateId } = req.body || {};
  if (!boardId || !updateId) return res.status(400).json({ error: "Missing fields" });
  io.to(boardId).emit("boardUpdated", { boardData, updateId });
  res.sendStatus(200);
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log("Server on", PORT));
