import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";


import prisma from "./prisma.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { readSession, setSession, clearSession } from "./session.js";

dotenv.config();

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

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

// Cookies (auth uses signed httpOnly cookie)
app.use(cookieParser(process.env.AUTH_COOKIE_SECRET || "dev_change_me"));

// -----------------------------
// API
// -----------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "beyond-silhouette", time: new Date().toISOString() });
});

// DB connectivity smoke test (Prisma)
app.get("/api/db/health", async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      ok: false,
      db: "not_configured",
      error: "DATABASE_URL is not set",
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, db: "connected", time: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      db: "error",
      error: err?.message || "Database connection failed",
    });
  }
});

// -----------------------------
// AUTH (backend foundation)
// -----------------------------
app.get("/api/me", async (req, res) => {
  const sess = readSession(req);
  if (!sess?.userId) return res.status(401).json({ ok: false, user: null });

  try {
    const user = await prisma.user.findUnique({
      where: { id: sess.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });

    if (!user) return res.status(401).json({ ok: false, user: null });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to load user" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim() || null;

    // Prisma schema default role is "customer"
    const role = "customer";

    if (!email) return res.status(400).json({ ok: false, error: "Email is required" });
    if (!password || password.length < 6) {
      return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ ok: false, error: "Email already registered" });

    const passwordHash = hashPassword(password);

    const user = await prisma.user.create({
      data: { email, name, passwordHash, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    setSession(res, { userId: user.id, email: user.email, role: user.role });
    return res.status(201).json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, passwordHash: true, createdAt: true },
    });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    setSession(res, { userId: user.id, email: user.email, role: user.role });
    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(res);
  return res.json({ ok: true });
});

// Optional: Google Sign-In (only works if GOOGLE_CLIENT_ID is set)
app.post("/api/auth/google", async (req, res) => {
  if (!googleClient) {
    return res.status(501).json({
      ok: false,
      error: "Google auth is not configured on this server.",
      missing: ["GOOGLE_CLIENT_ID"],
    });
  }

  const idToken = String(req.body?.idToken || "").trim();
  if (!idToken) {
    return res.status(400).json({ ok: false, error: "Missing idToken" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = String(payload?.email || "").trim().toLowerCase();
    const name = String(payload?.name || "").trim();

    if (!email) return res.status(400).json({ ok: false, error: "Google token missing email" });

    // Create-or-login user
    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (!user) {
      const randomPw = crypto.randomBytes(32).toString("hex");
      const passwordHash = await hashPassword(randomPw);

      user = await prisma.user.create({
        data: {
          email,
          name: name || null,
          passwordHash,
          role: "customer",
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
    }

    setSession(res, { userId: user.id });
    setSession(res, { userId: user.id, email: user.email, role: user.role });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(401).json({ ok: false, error: err?.message || "Invalid Google token" });
  }
});
// -----------------------------
// ORDERS (MVP)
// - Requires authenticated session
// - Validates products + per-size inventory
// - Atomically decrements stock in a DB transaction
// -----------------------------
function requireUser(req, res) {
  const sess = readSession(req);
  if (!sess?.userId) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return null;
  }

  return sess;
  function requireAdmin(req, res) {
    const sess = requireUser(req, res);
    if (!sess) return null;
    if (sess.role !== "admin") {
      res.status(403).json({ ok: false, error: "Admin only" });
      return null;
    }
    return sess;
  }

}

function parseQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

// List my orders (canonical)
app.get("/api/orders/my", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  try {
    const ordersRaw = await prisma.order.findMany({
      where: { userId: sess.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        subtotal: true,
        total: true,
        currency: true,
        status: true,
        createdAt: true,
        items: {
          select: {
            productId: true,
            size: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });

    // Add compatibility aliases expected by frontend
    const orders = ordersRaw.map((o) => ({
      ...o,
      subtotalJMD: o.subtotal,
      totalJMD: o.total,
    }));

    return res.json({ ok: true, orders });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Failed to load orders" });
  }
});


// Backward-compatible alias (frontend in ZIP calls this)
app.get("/api/orders/me", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  try {
    const ordersRaw = await prisma.order.findMany({
      where: { userId: sess.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        subtotal: true,
        total: true,
        currency: true,
        status: true,
        createdAt: true,
        items: { select: { productId: true, size: true, quantity: true, unitPrice: true } },
      },
    });

    const orders = ordersRaw.map((o) => ({
      ...o,
      subtotalJMD: o.subtotal,
      totalJMD: o.total,
    }));

    return res.json({ ok: true, orders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to load orders" });
  }
});

// Receipt / order detail (frontend calls /api/orders/:id)
app.get("/api/orders/:id", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  const orderId = String(req.params?.id || "").trim();
  if (!orderId) return res.status(400).json({ ok: false, error: "Missing order id" });

  try {
    const o = await prisma.order.findFirst({
      where: { id: orderId, userId: sess.userId },
      select: {
        id: true,
        createdAt: true,
        status: true,
        subtotal: true,
        total: true,
        currency: true,
        items: {
          select: {
            size: true,
            quantity: true,
            unitPrice: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    if (!o) return res.status(404).json({ ok: false, error: "Order not found" });

    // Shape to match frontend expectations
    const order = {
      id: o.id,
      createdAt: o.createdAt,
      status: o.status,
      subtotalJMD: o.subtotal,
      totalJMD: o.total,
      currency: o.currency,
      items: (o.items || []).map((it) => ({
        name: it.product?.name || "Item",
        size: it.size,
        qty: it.quantity,
        price: it.unitPrice,
      })),
    };

    return res.json({ ok: true, order });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to load order" });
  }
});



// Add compatibility aliases expected by frontend
const orders = ordersRaw.map((o) => ({
  ...o,
  subtotalJMD: o.subtotal,
  totalJMD: o.total,
}));

return res.json({ ok: true, orders });
  } catch (err) {
  return res.status(500).json({ ok: false, error: err?.message || "Failed to load orders" });
}
});

// -----------------------------
// ADMIN (requires admin role)
// -----------------------------

GET    /api/admin/products
POST   /api/admin/products
PATCH  /api/admin/products/:id
PATCH  /api/admin/inventory

// -----------------------------
// FRONTEND (same-domain hosting)
// -----------------------------
// Repo layout: /client and /server (this file is /server/src/server.js)
// Project root is TWO levels up from /server/src
const projectRoot = path.resolve(__dirname, "..", "..");
const clientDir = path.join(projectRoot, "client");

app.use(express.static(clientDir));

// Serve homepage
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "index.html")));

app.listen(PORT, () => {
  console.log(`Beyond Silhouette server running on http://localhost:${PORT}`);
});
