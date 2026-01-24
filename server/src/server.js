import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import prisma from "./prisma.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { readSession, setSession, clearSession } from "./session.js";

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
}

function parseQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

app.post("/api/orders", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = rawItems
    .map((it) => ({
      productId: String(it?.productId || "").trim(),
      size: String(it?.size || "").trim(),
      quantity: parseQty(it?.quantity ?? it?.qty),
    }))
    .filter((it) => it.productId && it.size && it.quantity > 0);

  if (!items.length) {
    return res.status(400).json({ ok: false, error: "Cart is empty" });
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Load products in one go (server is source of truth for price)
      const productIds = Array.from(new Set(items.map((i) => i.productId)));
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, priceJMD: true, isPublished: true, name: true },
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      const outOfStock = [];

      for (const it of items) {
        const p = productById.get(it.productId);
        if (!p) {
          outOfStock.push({ productId: it.productId, size: it.size, available: 0, reason: "NOT_FOUND" });
          continue;
        }

        // Check inventory (compound unique: productId+size)
        const inv = await tx.inventory.findUnique({
          where: { productId_size: { productId: it.productId, size: it.size } },
          select: { stock: true },
        });

        const available = Number(inv?.stock ?? 0);
        if (available < it.quantity) {
          outOfStock.push({ productId: it.productId, size: it.size, available });
          continue;
        }

        // Atomic decrement: only decrement if stock is still >= qty
        const updated = await tx.inventory.updateMany({
          where: {
            productId: it.productId,
            size: it.size,
            stock: { gte: it.quantity },
          },
          data: { stock: { decrement: it.quantity } },
        });

        if (updated.count !== 1) {
          const inv2 = await tx.inventory.findUnique({
            where: { productId_size: { productId: it.productId, size: it.size } },
            select: { stock: true },
          });
          outOfStock.push({ productId: it.productId, size: it.size, available: Number(inv2?.stock ?? 0) });
        }
      }

      if (outOfStock.length) {
        const err = new Error("OUT_OF_STOCK");
        err.code = "OUT_OF_STOCK";
        err.details = outOfStock;
        throw err;
      }

      const orderItems = items.map((it) => {
        const p = productById.get(it.productId);
        return {
          productId: it.productId,
          size: it.size,
          quantity: it.quantity,
          unitPrice: Number(p?.priceJMD ?? 0),
        };
      });

      const subtotal = orderItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);
      const total = subtotal;

      return tx.order.create({
        data: {
          userId: sess.userId,
          subtotal,
          total,
          currency: "JMD",
          status: "processing",
          items: { create: orderItems },
        },
        select: { id: true, subtotal: true, total: true, currency: true, status: true, createdAt: true },
      });
    });

    return res.status(201).json({ ok: true, order });
  } catch (err) {
    if (err?.code === "OUT_OF_STOCK") {
      return res.status(409).json({ ok: false, code: "OUT_OF_STOCK", items: err.details || [] });
    }
    return res.status(500).json({ ok: false, error: err?.message || "Failed to create order" });
  }
});

app.get("/api/orders/my", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  try {
    const orders = await prisma.order.findMany({
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

    return res.json({ ok: true, orders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to load orders" });
  }
});

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
