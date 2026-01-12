import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const app = express();

// Security / logging
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("dev"));

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Cookies (auth will use httpOnly cookie)
app.use(cookieParser(process.env.AUTH_COOKIE_SECRET || "dev_change_me"));

// -----------------------------
// API
// -----------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "beyond-silhouette", time: new Date().toISOString() });
});

// TODO (next milestone):
// - /api/auth/register, /api/auth/login, /api/auth/logout, /api/me
// - /api/products
// - /api/orders

// -----------------------------
// FRONTEND (same-domain hosting)
// -----------------------------
// Serve the existing approved UI from /client
const clientDir = path.resolve(__dirname, "..", "..", "client");
app.use(express.static(clientDir));

// Make direct navigation work for known static pages
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "index.html")));

app.listen(PORT, () => {
  console.log(`Beyond Silhouette server running on http://localhost:${PORT}`);
});
