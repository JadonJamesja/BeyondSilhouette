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
// Accepts either:
// - { credential: "..." }  (Google Identity Services)
// - { idToken: "..." }     (older/manual testing)
app.post("/api/auth/google", async (req, res) => {
  if (!googleClient) {
    return res.status(501).json({
      ok: false,
      error: "Google auth is not configured on this server.",
      missing: ["GOOGLE_CLIENT_ID"],
    });
  }

  const token = String(req.body?.credential || req.body?.idToken || "").trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: "Missing credential" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = String(payload?.email || "").trim().toLowerCase();
    const name = String(payload?.name || "").trim() || null;

    if (!email) return res.status(400).json({ ok: false, error: "Google token missing email" });

    // Create-or-login user
    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (!user) {
      const randomPw = crypto.randomBytes(32).toString("hex");
      const passwordHash = hashPassword(randomPw);

      user = await prisma.user.create({
        data: { email, name, passwordHash, role: "customer" },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
    }

    setSession(res, { userId: user.id, email: user.email, role: user.role });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(401).json({ ok: false, error: err?.message || "Invalid Google token" });
  }
});

// -----------------------------
// DEV ONLY: Promote user to admin (remove after use)
// Protect with DEV_ADMIN_SECRET (Railway env var)
// -----------------------------
app.post("/api/dev/make-admin", async (req, res) => {
  const secret = String(req.body?.secret || "");
  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!process.env.DEV_ADMIN_SECRET) {
    return res.status(500).json({ ok: false, error: "DEV_ADMIN_SECRET is not set" });
  }
  if (secret !== String(process.env.DEV_ADMIN_SECRET)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!email) {
    return res.status(400).json({ ok: false, error: "Email is required" });
  }

  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role: "admin" },
      select: { id: true, email: true, role: true },
    });

    // Update session too (useful if you're logged in as this user)
    setSession(res, { userId: user.id, email: user.email, role: user.role });

    return res.json({ ok: true, user });
  } catch (err) {
    // Prisma "Record to update not found" => P2025
    if (err?.code === "P2025" || String(err?.message || "").includes("Record to update not found")) {
      return res.status(404).json({ ok: false, error: "User not found. Create the account first, then promote." });
    }
    return res.status(500).json({ ok: false, error: err?.message || "Failed to promote user" });
  }
});

// -----------------------------
// HELPERS (auth gates used below)
// -----------------------------
function requireUser(req, res) {
  const sess = readSession(req);
  if (!sess?.userId) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return null;
  }
  return sess;
}

function requireAdmin(req, res) {
  const sess = requireUser(req, res);
  if (!sess) return null;
  if (sess.role !== "admin") {
    res.status(403).json({ ok: false, error: "Admin only" });
    return null;
  }
  return sess;
}

function parseQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

// -----------------------------
// ORDERS (MVP)
// -----------------------------
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
    return res.status(500).json({ ok: false, error: err?.message || "Failed to load orders" });
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

// -----------------------------
// ADMIN (requires admin role)
// -----------------------------

// GET /api/admin/products
app.get("/api/admin/products", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        priceJMD: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        images: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            url: true,
            alt: true,
            sortOrder: true,
            createdAt: true,
          },
        },
        inventory: {
          orderBy: { size: "asc" },
          select: {
            id: true,
            size: true,
            stock: true,
            updatedAt: true,
          },
        },
      },
    });

    return res.json({ ok: true, products });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to load admin products",
    });
  }
});

// POST /api/admin/products
app.post("/api/admin/products", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    const name = String(req.body?.name || "").trim();
    const slugRaw = req.body?.slug;
    const slug = slugRaw === null || slugRaw === undefined ? null : String(slugRaw).trim() || null;

    const descriptionRaw = req.body?.description;
    const description =
      descriptionRaw === null || descriptionRaw === undefined ? null : String(descriptionRaw).trim() || null;

    const priceJMDNum = Number(req.body?.priceJMD);
    const priceJMD = Number.isFinite(priceJMDNum) ? Math.max(0, Math.round(priceJMDNum)) : NaN;

    const isPublished = Boolean(req.body?.isPublished);

    const imagesIn = Array.isArray(req.body?.images) ? req.body.images : [];
    const inventoryIn = Array.isArray(req.body?.inventory) ? req.body.inventory : [];

    if (!name) return res.status(400).json({ ok: false, error: "name is required" });
    if (!Number.isFinite(priceJMD)) return res.status(400).json({ ok: false, error: "priceJMD must be a number" });

    const images = imagesIn
      .map((img) => ({
        url: String(img?.url || "").trim(),
        alt: img?.alt === undefined || img?.alt === null ? null : String(img.alt).trim() || null,
        sortOrder: Number.isFinite(Number(img?.sortOrder)) ? Math.round(Number(img.sortOrder)) : 0,
      }))
      .filter((img) => img.url);

    // De-dupe inventory by size (keep last)
    const invMap = new Map();
    for (const row of inventoryIn) {
      const size = String(row?.size || "").trim();
      if (!size) continue;
      const stockNum = Number(row?.stock);
      const stock = Number.isFinite(stockNum) ? Math.max(0, Math.round(stockNum)) : 0;
      invMap.set(size, stock);
    }
    const inventory = Array.from(invMap.entries()).map(([size, stock]) => ({ size, stock }));

    const created = await prisma.product.create({
      data: {
        slug,
        name,
        description,
        priceJMD,
        isPublished,
        images: images.length ? { create: images } : undefined,
        inventory: inventory.length ? { create: inventory } : undefined,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        priceJMD: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        images: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            url: true,
            alt: true,
            sortOrder: true,
            createdAt: true,
          },
        },
        inventory: {
          orderBy: { size: "asc" },
          select: {
            id: true,
            size: true,
            stock: true,
            updatedAt: true,
          },
        },
      },
    });

    return res.status(201).json({ ok: true, product: created });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("Unique constraint") || msg.includes("unique") || err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: "Duplicate unique field (slug/email/etc)" });
    }
    return res.status(500).json({ ok: false, error: err?.message || "Failed to create product" });
  }
});

// PATCH /api/admin/products/:id
// Updates basic product fields + optional full replace of images/inventory arrays.
app.patch("/api/admin/products/:id", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = String(req.params?.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "Missing product id" });

  try {
    const data = {};

    // Optional fields
    if (req.body?.slug !== undefined) {
      const slugRaw = req.body.slug;
      data.slug = slugRaw === null ? null : String(slugRaw).trim() || null;
    }
    if (req.body?.name !== undefined) data.name = String(req.body.name || "").trim();
    if (req.body?.description !== undefined) {
      const dRaw = req.body.description;
      data.description = dRaw === null ? null : String(dRaw).trim() || null;
    }
    if (req.body?.priceJMD !== undefined) {
      const n = Number(req.body.priceJMD);
      if (!Number.isFinite(n)) return res.status(400).json({ ok: false, error: "priceJMD must be a number" });
      data.priceJMD = Math.max(0, Math.round(n));
    }
    if (req.body?.isPublished !== undefined) data.isPublished = Boolean(req.body.isPublished);

    const imagesIn = req.body?.images;
    const inventoryIn = req.body?.inventory;

    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (!exists) {
        const err = new Error("NOT_FOUND");
        err.code = "NOT_FOUND";
        throw err;
      }

      // Optional full replace: images
      if (Array.isArray(imagesIn)) {
        await tx.productImage.deleteMany({ where: { productId: id } });

        const images = imagesIn
          .map((img) => ({
            url: String(img?.url || "").trim(),
            alt: img?.alt === undefined || img?.alt === null ? null : String(img.alt).trim() || null,
            sortOrder: Number.isFinite(Number(img?.sortOrder)) ? Math.round(Number(img.sortOrder)) : 0,
          }))
          .filter((img) => img.url);

        if (images.length) {
          await tx.productImage.createMany({
            data: images.map((im) => ({ ...im, productId: id })),
          });
        }
      }

      // Optional full replace: inventory
      if (Array.isArray(inventoryIn)) {
        await tx.inventory.deleteMany({ where: { productId: id } });

        const invMap = new Map();
        for (const row of inventoryIn) {
          const size = String(row?.size || "").trim();
          if (!size) continue;
          const stockNum = Number(row?.stock);
          const stock = Number.isFinite(stockNum) ? Math.max(0, Math.round(stockNum)) : 0;
          invMap.set(size, stock);
        }
        const inventory = Array.from(invMap.entries()).map(([size, stock]) => ({ size, stock }));

        if (inventory.length) {
          await tx.inventory.createMany({
            data: inventory.map((r) => ({ ...r, productId: id })),
          });
        }
      }

      // Update core fields (if any)
      if (Object.keys(data).length) {
        await tx.product.update({ where: { id }, data });
      }

      const product = await tx.product.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          priceJMD: true,
          isPublished: true,
          createdAt: true,
          updatedAt: true,
          images: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, url: true, alt: true, sortOrder: true, createdAt: true },
          },
          inventory: {
            orderBy: { size: "asc" },
            select: { id: true, size: true, stock: true, updatedAt: true },
          },
        },
      });

      return product;
    });

    return res.json({ ok: true, product: result });
  } catch (err) {
    if (err?.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "Product not found" });
    const msg = String(err?.message || "");
    if (msg.includes("Unique constraint") || msg.includes("unique") || err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: "Duplicate unique field (slug/etc)" });
    }
    return res.status(500).json({ ok: false, error: err?.message || "Failed to update product" });
  }
});

// PATCH /api/admin/inventory
// Bulk upsert inventory rows: [{ productId, size, stock }] OR { items: [...] }
app.patch("/api/admin/inventory", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const rowsIn = Array.isArray(req.body?.items) ? req.body.items : Array.isArray(req.body) ? req.body : [];
  const rows = rowsIn
    .map((r) => ({
      productId: String(r?.productId || "").trim(),
      size: String(r?.size || "").trim(),
      stock: Number.isFinite(Number(r?.stock)) ? Math.max(0, Math.round(Number(r.stock))) : NaN,
    }))
    .filter((r) => r.productId && r.size);

  if (!rows.length) return res.status(400).json({ ok: false, error: "No inventory rows provided" });
  if (rows.some((r) => !Number.isFinite(r.stock))) {
    return res.status(400).json({ ok: false, error: "stock must be a number" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const r of rows) {
        const rec = await tx.inventory.upsert({
          where: { productId_size: { productId: r.productId, size: r.size } },
          update: { stock: r.stock },
          create: { productId: r.productId, size: r.size, stock: r.stock },
          select: { id: true, productId: true, size: true, stock: true, updatedAt: true },
        });
        out.push(rec);
      }
      return out;
    });

    return res.json({ ok: true, items: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to update inventory" });
  }
});

// -----------------------------
// ADMIN PAGE PATHWAY + GATE (server-side)
// -----------------------------
app.get("/admin", (req, res) => {
  const sess = readSession(req);
  if (!sess?.userId) return res.redirect("/admin/login.html");
  if (sess.role !== "admin") return res.redirect("/");
  return res.redirect("/admin/dashboard.html");
});

app.use("/admin", (req, res, next) => {
  const p = req.path || "/";

  // Always allow login page (and typical static assets) without admin role
  const isPublic =
    p === "/login.html" ||
    p.endsWith(".css") ||
    p.endsWith(".js") ||
    p.endsWith(".png") ||
    p.endsWith(".jpg") ||
    p.endsWith(".jpeg") ||
    p.endsWith(".webp") ||
    p.endsWith(".svg") ||
    p.endsWith(".ico");

  if (isPublic) return next();

  const sess = readSession(req);
  if (!sess?.userId) return res.redirect("/admin/login.html");
  if (sess.role !== "admin") return res.redirect("/");

  return next();
});

// -----------------------------
// FRONTEND (same-domain hosting)
// -----------------------------
const projectRoot = path.resolve(__dirname, "..", "..");
const clientDir = path.join(projectRoot, "client");

// Static files (this comes AFTER admin gate middleware on purpose)
app.use(express.static(clientDir));

// Serve homepage
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "index.html")));

app.listen(PORT, () => {
  console.log(`Beyond Silhouette server running on http://localhost:${PORT}`);
});