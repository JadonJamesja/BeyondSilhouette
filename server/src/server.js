import path from "path";
import fs from "fs";
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

const CLIENT_DIR = path.join(__dirname, "../../client");
const HOME_UPLOAD_DIR = path.join(CLIENT_DIR, "uploads", "home");
if (!fs.existsSync(HOME_UPLOAD_DIR)) fs.mkdirSync(HOME_UPLOAD_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);

const app = express();

// Security / logging
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("dev"));

// Body parsing
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: false }));

// Cookies (auth uses signed httpOnly cookie)
app.use(cookieParser(process.env.AUTH_COOKIE_SECRET || "dev_change_me"));

// -----------------------------
// API HELPER FUNCTIONS
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


function safeImageExtension(mime = "", fallbackName = "") {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";

  const lower = String(fallbackName || "").toLowerCase();
  if (lower.endsWith(".png")) return ".png";
  if (lower.endsWith(".webp")) return ".webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return ".jpg";
  return ".jpg";
}

function normalizeHomeUploadUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/home/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return "/uploads/home/" + raw.replace(/^\/+/, "");
}

function isExistingHomeUploadUrl(value) {
  const url = normalizeHomeUploadUrl(value);
  if (!url) return false;
  if (!url.startsWith("/uploads/home/")) return true;
  const filename = path.basename(url);
  if (!filename || filename === "." || filename === "..") return false;
  const absPath = path.join(HOME_UPLOAD_DIR, filename);
  return fs.existsSync(absPath);
}

function sanitizeHomeUploadUrls(values) {
  const list = Array.isArray(values) ? values : [];
  return list
    .map((value) => normalizeHomeUploadUrl(value))
    .filter((url) => url && isExistingHomeUploadUrl(url));
}

function parseQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function hasPrismaModel(name) {
  return !!(prisma && Object.prototype.hasOwnProperty.call(prisma, name) && prisma[name]);
}

async function cleanupExpiredReservations(db) {
  if (!db?.inventoryReservation) return;
  await db.inventoryReservation.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
}

async function reservedQtyByOthers(db, { productId, size, userId }) {
  if (!db?.inventoryReservation) return 0;
  const rows = await db.inventoryReservation.findMany({
    where: {
      productId,
      size,
      ...(userId ? { NOT: { userId } } : {}),
      expiresAt: { gt: new Date() },
    },
    select: { qty: true },
  });
  return rows.reduce((sum, row) => sum + Number(row?.qty || 0), 0);
}

async function getAvailableStock(db, { productId, size, userId }) {
  const inv = await db.inventory.findUnique({
    where: { productId_size: { productId, size } },
    select: { stock: true },
  });
  const stock = Number(inv?.stock || 0);
  const reservedByOthers = await reservedQtyByOthers(db, { productId, size, userId });
  return Math.max(0, stock - reservedByOthers);
}

async function buildCartResponse(db, userId) {
  const rows = await db.cartItem.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
          priceJMD: true,
          isPublished: true,
          images: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { url: true, alt: true },
          },
        },
      },
    },
  });

  const items = rows.map((row) => ({
    productId: row.productId,
    size: row.size,
    qty: Number(row.qty || 0),
    title: row.product?.name || "Product",
    priceJMD: Number(row.product?.priceJMD || 0),
    media: { coverUrl: row.product?.images?.[0]?.url || "" },
    product: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          priceJMD: Number(row.product.priceJMD || 0),
          isPublished: !!row.product.isPublished,
          images: row.product.images || [],
        }
      : null,
  }));

  const totalQty = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const totalPrice = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.priceJMD || 0), 0);

  return { ok: true, items, totalQty, totalPrice };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "beyond-silhouette", time: new Date().toISOString() });
});

// Public runtime config (safe to expose)
app.get("/api/public/config", (req, res) => {
  res.json({
    ok: true,
    googleClientId: GOOGLE_CLIENT_ID || null,
  });
});

// DB connectivity smoke test (Prisma) (Prisma)
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
// PUBLIC PRODUCTS (for shop)
// -----------------------------
app.get("/api/products", async (req, res) => {
  // Public endpoint: allow simple cross-origin GET (safe for products)
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const products = await prisma.product.findMany({
      where: { isPublished: true },
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
          select: { url: true, alt: true, sortOrder: true },
        },
        inventory: {
          orderBy: { size: "asc" },
          select: { size: true, stock: true },
        },
      },
    });

    const mapped = products.map((p) => {
      const stockBySize = { S: 0, M: 0, L: 0, XL: 0 };

      for (const row of p.inventory || []) {
        const k = String(row.size || "").trim().toUpperCase();
        if (k === "S" || k === "M" || k === "L" || k === "XL") {
          stockBySize[k] = Number.isFinite(Number(row.stock))
            ? Math.max(0, Math.round(Number(row.stock)))
            : 0;
        }
      }

      const coverUrl =
        p.images && p.images.length > 0 ? String(p.images[0].url) : "";

      return {
        id: p.id,
        slug: p.slug || null,
        title: p.name, // frontend expects title
        description: p.description || "",
        priceJMD: p.priceJMD,
        status: p.isPublished ? "published" : "draft",
        sizes: ["S", "M", "L", "XL"],
        stockBySize,
        media: { coverUrl },
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    return res.json({ ok: true, products: mapped });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to load products",
    });
  }
});


// -----------------------------
// SITE HOME SETTINGS (public + admin)
// -----------------------------

// Public: GET /api/site/home
// Returns the singleton home settings + featured products (published only).
app.get("/api/site/home", async (req, res) => {
  try {
    if (!hasPrismaModel("siteHomeSettings")) {
      return res.status(503).json({
        ok: false,
        error: "Homepage settings model is unavailable. Run Prisma generate/migrations before using this endpoint.",
      });
    }

    const settings = await prisma.siteHomeSettings.findUnique({
      where: { id: "singleton" },
      select: {
        id: true,
        heroTitle: true,
        heroSubtitle: true,
        slideshowUrls: true,
        featuredProductIds: true,
        promoEnabled: true,
        promoImageUrl: true,
        promoTitle: true,
        promoSubtitle: true,
        promoCtaText: true,
        promoCtaLink: true,
        updatedAt: true,
      },
    });

    const featuredIds = Array.isArray(settings?.featuredProductIds) ? settings.featuredProductIds : [];
    const slideshowUrls = sanitizeHomeUploadUrls(settings?.slideshowUrls);
    const promoImageUrl = isExistingHomeUploadUrl(settings?.promoImageUrl)
      ? normalizeHomeUploadUrl(settings?.promoImageUrl)
      : "";
    const featuredProducts = featuredIds.length
      ? await prisma.product.findMany({
        where: { id: { in: featuredIds }, isPublished: true },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          priceJMD: true,
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true } },
          inventory: { orderBy: { size: "asc" }, select: { size: true, stock: true } },
        },
      })
      : [];

    // Keep stable order according to featuredProductIds
    const byId = new Map(featuredProducts.map(p => [p.id, p]));
    const orderedFeatured = featuredIds.map(id => byId.get(id)).filter(Boolean).map((p) => {
      const stockBySize = { S: 0, M: 0, L: 0, XL: 0 };
      for (const row of p.inventory || []) {
        const k = String(row.size || "").trim().toUpperCase();
        if (k === "S" || k === "M" || k === "L" || k === "XL") stockBySize[k] = Math.max(0, Number(row.stock || 0));
      }
      return {
        id: p.id,
        slug: p.slug || null,
        title: p.name,
        description: p.description || "",
        priceJMD: p.priceJMD,
        sizes: ["S", "M", "L", "XL"],
        stockBySize,
        media: { coverUrl: p.images?.[0]?.url || "" },
        isPublished: true,
      };
    });

    return res.json({
      ok: true,
      hasSettings: !!settings,
      home: {
        heroTitle: settings?.heroTitle || null,
        heroSubtitle: settings?.heroSubtitle || null,
        promoEnabled: !!settings?.promoEnabled,
        promoImageUrl: promoImageUrl || null,
        promoTitle: settings?.promoTitle || null,
        promoSubtitle: settings?.promoSubtitle || null,
        promoCtaText: settings?.promoCtaText || null,
        promoCtaLink: settings?.promoCtaLink || null,
        slideshowUrls,
        featuredProductIds: featuredIds,
        updatedAt: settings?.updatedAt || null,
      },
      featured: orderedFeatured,
    });
  } catch (err) {
    console.error("GET /api/site/home failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load home settings" });
  }
});

// Admin: GET /api/admin/site/home
app.get("/api/admin/site/home", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  try {
    if (!hasPrismaModel("siteHomeSettings")) {
      return res.status(503).json({
        ok: false,
        error: "Homepage settings model is unavailable. Run Prisma generate/migrations before using this endpoint.",
      });
    }

    const settings = await prisma.siteHomeSettings.findUnique({
      where: { id: "singleton" },
      select: {
        id: true,
        heroTitle: true,
        heroSubtitle: true,
        slideshowUrls: true,
        featuredProductIds: true,
        promoEnabled: true,
        promoImageUrl: true,
        promoTitle: true,
        promoSubtitle: true,
        promoCtaText: true,
        promoCtaLink: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const normalized = settings
      ? {
        ...settings,
        slideshowUrls: sanitizeHomeUploadUrls(settings.slideshowUrls),
        promoImageUrl: isExistingHomeUploadUrl(settings.promoImageUrl)
          ? normalizeHomeUploadUrl(settings.promoImageUrl)
          : null,
      }
      : null;

    return res.json({
      ok: true,
      hasSettings: !!settings,
      home: normalized || {
        id: "singleton",
        heroTitle: null,
        heroSubtitle: null,
        promoEnabled: false,
        promoImageUrl: null,
        promoTitle: null,
        promoSubtitle: null,
        promoCtaText: null,
        promoCtaLink: null,
        slideshowUrls: [],
        featuredProductIds: [],
        createdAt: null,
        updatedAt: null,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/site/home failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load home settings" });
  }
});

// Admin: POST /api/admin/site/home/upload
app.post("/api/admin/site/home/upload", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  try {
    const dataUrl = String(req.body?.dataUrl || "").trim();
    const filename = String(req.body?.filename || "slide").trim();

    if (!dataUrl.startsWith("data:image/")) {
      return res.status(400).json({ ok: false, error: "Invalid image payload" });
    }

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ ok: false, error: "Invalid data URL format" });
    }

    const mime = match[1];
    const base64 = match[2];
    const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowed.has(mime)) {
      return res.status(400).json({ ok: false, error: "Only PNG, JPG, and WEBP are allowed" });
    }

    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) {
      return res.status(400).json({ ok: false, error: "Empty image" });
    }
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "Image must be 5MB or smaller" });
    }

    const ext = safeImageExtension(mime, filename);
    const finalName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    const absPath = path.join(HOME_UPLOAD_DIR, finalName);
    fs.writeFileSync(absPath, buffer);

    return res.json({ ok: true, url: `/uploads/home/${finalName}` });
  } catch (err) {
    console.error("POST /api/admin/site/home/upload failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to upload image" });
  }
});

// Admin: PUT /api/admin/site/home (upsert singleton)
app.put("/api/admin/site/home", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  const heroTitle = req.body?.heroTitle === null || req.body?.heroTitle === undefined ? null : String(req.body.heroTitle).trim() || null;
  const heroSubtitle = req.body?.heroSubtitle === null || req.body?.heroSubtitle === undefined ? null : String(req.body.heroSubtitle).trim() || null;

  const slideshowUrlsIn = Array.isArray(req.body?.slideshowUrls) ? req.body.slideshowUrls : [];
  const slideshowUrls = sanitizeHomeUploadUrls(slideshowUrlsIn).slice(0, 20);

  const featuredIn = Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds : [];
  const featuredProductIds = featuredIn.map((id) => String(id || "").trim()).filter(Boolean).slice(0, 20);

  const promoEnabled = !!req.body?.promoEnabled;
  const promoImageUrl = req.body?.promoImageUrl === null || req.body?.promoImageUrl === undefined
    ? null
    : (isExistingHomeUploadUrl(req.body.promoImageUrl)
      ? normalizeHomeUploadUrl(req.body.promoImageUrl)
      : null);
  const promoTitle = req.body?.promoTitle === null || req.body?.promoTitle === undefined ? null : String(req.body.promoTitle).trim() || null;
  const promoSubtitle = req.body?.promoSubtitle === null || req.body?.promoSubtitle === undefined ? null : String(req.body.promoSubtitle).trim() || null;
  const promoCtaText = req.body?.promoCtaText === null || req.body?.promoCtaText === undefined ? null : String(req.body.promoCtaText).trim() || null;
  const promoCtaLink = req.body?.promoCtaLink === null || req.body?.promoCtaLink === undefined ? null : String(req.body.promoCtaLink).trim() || null;

  try {
    if (!hasPrismaModel("siteHomeSettings")) {
      return res.status(500).json({
        ok: false,
        error: "siteHomeSettings model unavailable. Run prisma generate + migrate deploy.",
      });
    }

    const saved = await prisma.siteHomeSettings.upsert({
      where: { id: "singleton" },
      update: { heroTitle, heroSubtitle, slideshowUrls, featuredProductIds, promoEnabled, promoImageUrl, promoTitle, promoSubtitle, promoCtaText, promoCtaLink },
      create: { id: "singleton", heroTitle, heroSubtitle, slideshowUrls, featuredProductIds, promoEnabled, promoImageUrl, promoTitle, promoSubtitle, promoCtaText, promoCtaLink },
      select: {
        id: true,
        heroTitle: true,
        heroSubtitle: true,
        slideshowUrls: true,
        featuredProductIds: true,
        promoEnabled: true,
        promoImageUrl: true,
        promoTitle: true,
        promoSubtitle: true,
        promoCtaText: true,
        promoCtaLink: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      home: {
        ...saved,
        slideshowUrls: sanitizeHomeUploadUrls(saved.slideshowUrls),
        promoImageUrl: isExistingHomeUploadUrl(saved.promoImageUrl)
          ? normalizeHomeUploadUrl(saved.promoImageUrl)
          : null,
      },
    });
  } catch (err) {
    console.error("PUT /api/admin/site/home failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to save home settings" });
  }
});

// -----------------------------
// ADMIN CONFIG (thresholds, etc.)
// -----------------------------

app.get("/api/admin/config", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  try {
    if (!hasPrismaModel("adminConfig")) {
      return res.status(500).json({
        ok: false,
        error: "adminConfig model unavailable. Run prisma generate + migrate deploy.",
      });
    }
    const cfg = await prisma.adminConfig.findUnique({
      where: { id: "singleton" },
      select: { id: true, lowStockThreshold: true, updatedAt: true },
    });
    return res.json({ ok: true, config: cfg || { id: "singleton", lowStockThreshold: 3, updatedAt: null } });
  } catch (err) {
    console.error("GET /api/admin/config failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load admin config" });
  }
});

app.put("/api/admin/config", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  const n = Number(req.body?.lowStockThreshold);
  const lowStockThreshold = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;

  try {
    if (!hasPrismaModel("adminConfig")) {
      return res.status(500).json({
        ok: false,
        error: "adminConfig model unavailable. Run prisma generate + migrate deploy.",
      });
    }
    const cfg = await prisma.adminConfig.upsert({
      where: { id: "singleton" },
      update: { lowStockThreshold },
      create: { id: "singleton", lowStockThreshold },
      select: { id: true, lowStockThreshold: true, updatedAt: true },
    });
    return res.json({ ok: true, config: cfg });
  } catch (err) {
    console.error("PUT /api/admin/config failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to save admin config" });
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
    // Keep the signed session cookie aligned with the canonical DB role.
    // This prevents stale role data (e.g. after promoting a user to admin)
    // from blocking admin-only endpoints even when /api/me reports admin.
    setSession(res, { userId: user.id, email: user.email, role: user.role });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to load user" });
  }
});


app.patch("/api/me/profile", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  try {
    const name = String(req.body?.name || "").trim();
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!name) return res.status(400).json({ ok: false, error: "Display name is required" });
    if (!currentPassword) return res.status(400).json({ ok: false, error: "Current password is required" });

    const user = await prisma.user.findUnique({ where: { id: sess.userId } });
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ ok: false, error: "Current password is incorrect" });

    const data = { name };
    if (newPassword) data.passwordHash = await hashPassword(newPassword);

    const updated = await prisma.user.update({
      where: { id: sess.userId },
      data,
      select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });

    setSession(res, { userId: updated.id, email: updated.email, role: updated.role });
    return res.json({ ok: true, user: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Failed to update profile" });
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
// CART API
// -----------------------------

app.get("/api/cart", async (req, res) => {
  const sess = readSession(req);

  if (!sess?.userId) {
    return res.json({ ok: true, items: [], totalQty: 0, totalPrice: 0 });
  }

  try {
    const payload = await buildCartResponse(prisma, sess.userId);
    return res.json(payload);
  } catch (err) {
    console.error("GET /api/cart failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load cart" });
  }
});

app.post("/api/cart/add", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  const productId = String(req.body?.productId || "").trim();
  const size = String(req.body?.size || "").trim().toUpperCase();
  const qty = Math.max(1, parseQty(req.body?.qty || 1));

  if (!productId || !size) {
    return res.status(400).json({ ok: false, error: "Missing product or size" });
  }

  try {
    const payload = await prisma.$transaction(async (tx) => {
      await cleanupExpiredReservations(tx);

      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, isPublished: true },
      });
      if (!product || !product.isPublished) {
        const err = new Error('PRODUCT_NOT_FOUND');
        err.code = 'PRODUCT_NOT_FOUND';
        throw err;
      }

      const existing = await tx.cartItem.findUnique({
        where: { userId_productId_size: { userId: sess.userId, productId, size } },
        select: { qty: true },
      });
      const nextQty = Number(existing?.qty || 0) + qty;
      const available = await getAvailableStock(tx, { productId, size, userId: sess.userId });
      if (nextQty > available) {
        const err = new Error('OUT_OF_STOCK');
        err.code = 'OUT_OF_STOCK';
        err.available = available;
        throw err;
      }

      await tx.cartItem.upsert({
        where: { userId_productId_size: { userId: sess.userId, productId, size } },
        update: { qty: nextQty },
        create: { userId: sess.userId, productId, size, qty },
      });

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await tx.inventoryReservation.upsert({
        where: { userId_productId_size: { userId: sess.userId, productId, size } },
        update: { qty: nextQty, expiresAt },
        create: { userId: sess.userId, productId, size, qty: nextQty, expiresAt },
      });

      return buildCartResponse(tx, sess.userId);
    });

    return res.json(payload);
  } catch (err) {
    if (err?.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: 'Product not found' });
    }
    if (err?.code === 'OUT_OF_STOCK') {
      return res.status(409).json({ ok: false, error: 'Not enough stock available', available: Number(err.available || 0) });
    }
    console.error("POST /api/cart/add failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to add to cart" });
  }
});

app.patch("/api/cart/item", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  const productId = String(req.body?.productId || '').trim();
  const size = String(req.body?.size || '').trim().toUpperCase();
  const requestedQty = parseQty(req.body?.qty);

  if (!productId || !size) {
    return res.status(400).json({ ok: false, error: 'Missing product or size' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await cleanupExpiredReservations(tx);

      const current = await tx.cartItem.findUnique({
        where: { userId_productId_size: { userId: sess.userId, productId, size } },
        select: { id: true },
      });

      if (!current) {
        const payload = await buildCartResponse(tx, sess.userId);
        return { ...payload, appliedQty: 0 };
      }

      if (requestedQty <= 0) {
        await tx.cartItem.delete({ where: { userId_productId_size: { userId: sess.userId, productId, size } } });
        await tx.inventoryReservation.deleteMany({ where: { userId: sess.userId, productId, size } });
        const payload = await buildCartResponse(tx, sess.userId);
        return { ...payload, appliedQty: 0 };
      }

      const available = await getAvailableStock(tx, { productId, size, userId: sess.userId });
      const appliedQty = Math.min(requestedQty, available);

      if (appliedQty <= 0) {
        await tx.cartItem.delete({ where: { userId_productId_size: { userId: sess.userId, productId, size } } });
        await tx.inventoryReservation.deleteMany({ where: { userId: sess.userId, productId, size } });
        const payload = await buildCartResponse(tx, sess.userId);
        return { ...payload, appliedQty: 0 };
      }

      await tx.cartItem.update({
        where: { userId_productId_size: { userId: sess.userId, productId, size } },
        data: { qty: appliedQty },
      });

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await tx.inventoryReservation.upsert({
        where: { userId_productId_size: { userId: sess.userId, productId, size } },
        update: { qty: appliedQty, expiresAt },
        create: { userId: sess.userId, productId, size, qty: appliedQty, expiresAt },
      });

      const payload = await buildCartResponse(tx, sess.userId);
      return { ...payload, appliedQty };
    });

    return res.json(result);
  } catch (err) {
    console.error('PATCH /api/cart/item failed:', err);
    return res.status(500).json({ ok: false, error: 'Failed to update cart' });
  }
});

app.delete("/api/cart/item", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  const productId = String(req.body?.productId || '').trim();
  const size = String(req.body?.size || '').trim().toUpperCase();

  if (!productId || !size) {
    return res.status(400).json({ ok: false, error: 'Missing product or size' });
  }

  try {
    const payload = await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { userId: sess.userId, productId, size } });
      await tx.inventoryReservation.deleteMany({ where: { userId: sess.userId, productId, size } });
      return buildCartResponse(tx, sess.userId);
    });

    return res.json(payload);
  } catch (err) {
    console.error('DELETE /api/cart/item failed:', err);
    return res.status(500).json({ ok: false, error: 'Failed to remove item' });
  }
});

app.post("/api/cart/clear", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { userId: sess.userId } });
      await tx.inventoryReservation.deleteMany({ where: { userId: sess.userId } });
    });

    return res.json({ ok: true, items: [], totalQty: 0, totalPrice: 0 });
  } catch (err) {
    console.error('POST /api/cart/clear failed:', err);
    return res.status(500).json({ ok: false, error: 'Failed to clear cart' });
  }
});

// ===== ADMIN (requires admin role) =====

// ADMIN: list users (no password hashes)
app.get("/api/admin/users", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    return res.json({ ok: true, users });
  } catch (err) {
    console.error("GET /api/admin/users failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load users" });
  }
});

// ADMIN: update a user's role (no delete; prevents self-demotion)
app.patch("/api/admin/users/:id/role", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  const id = String(req.params?.id || "").trim();
  const role = String(req.body?.role || "").trim().toLowerCase();

  if (!id) return res.status(400).json({ ok: false, error: "Missing user id" });

  const allowed = new Set(["customer", "admin"]);
  if (!allowed.has(role)) return res.status(400).json({ ok: false, error: "Invalid role" });

  if (id === sess.userId && role !== "admin") {
    return res.status(400).json({ ok: false, error: "You cannot remove your own admin role." });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("PATCH /api/admin/users/:id/role failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to update user role" });
  }
});

// ADMIN: promote/demote a user by email
app.post("/api/admin/users/promote", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = String(req.body?.role || "admin").trim().toLowerCase();

  if (!email) return res.status(400).json({ ok: false, error: "Email is required" });
  if (!["customer", "admin"].includes(role)) {
    return res.status(400).json({ ok: false, error: "Invalid role" });
  }

  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (user.id === sess.userId && user.role !== "admin") {
      return res.status(400).json({ ok: false, error: "You cannot remove your own admin role." });
    }

    return res.json({ ok: true, user });
  } catch (err) {
    if (err?.code === "P2025" || String(err?.message || "").includes("Record to update not found")) {
      return res.status(404).json({ ok: false, error: "User not found." });
    }
    console.error("POST /api/admin/users/promote failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to update user role" });
  }
});

// ADMIN: dashboard stats (real DB)
app.get("/api/admin/stats", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  try {
    const cfg = hasPrismaModel("adminConfig")
      ? await prisma.adminConfig.findUnique({
          where: { id: "singleton" },
          select: { lowStockThreshold: true },
        })
      : null;
    const threshold = Number(cfg?.lowStockThreshold ?? 3);

    const [usersCount, ordersCount, lowInvRows, revenueAgg] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.inventory.findMany({
        where: { stock: { gt: 0, lte: threshold } },
        distinct: ["productId"],
        select: { productId: true },
      }),
      prisma.order.aggregate({ _sum: { total: true } }),
    ]);

    const lowStockCount = Array.isArray(lowInvRows) ? lowInvRows.length : 0;
    const revenueJMD = Number(revenueAgg?._sum?.total || 0);

    return res.json({
      ok: true,
      stats: { usersCount, ordersCount, lowStockCount, revenueJMD, lowStockThreshold: threshold },
    });
  } catch (err) {
    console.error("GET /api/admin/stats failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load stats" });
  }
});

// ADMIN: list orders
app.get("/api/admin/orders", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { email: true, name: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    return res.json({
      ok: true,
      orders: orders.map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        status: o.status,
        totalJMD: o.total,
        email: (o.user?.email || "").toLowerCase(),
        customerName: o.user?.name || null,
        items: o.items.map((it) => ({
          name: it.product?.name || it.productId,
          size: it.size,
          qty: it.quantity,
          priceJMD: it.unitPrice,
        })),
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/orders failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to list orders" });
  }
});

// ADMIN: single order (includes history)
app.get("/api/admin/orders/:id", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "Missing order id" });

  try {
    let order;
    try {
      order = await prisma.order.findUnique({
        where: { id },
        include: {
          user: { select: { email: true, name: true } },
          items: { include: { product: { select: { name: true } } } },
          ...(hasPrismaModel("orderStatusHistory") ? {
            history: {
              orderBy: { createdAt: "desc" },
              include: { actor: { select: { email: true, name: true } } },
            },
          } : {}),
        },
      });
    } catch (detailErr) {
      console.warn("GET /api/admin/orders/:id history fallback:", detailErr?.message || detailErr);
      order = await prisma.order.findUnique({
        where: { id },
        include: {
          user: { select: { email: true, name: true } },
          items: { include: { product: { select: { name: true } } } },
        },
      });
      if (order) order.history = [];
    }

    if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

    return res.json({
      ok: true,
      order: {
        id: order.id,
        createdAt: order.createdAt,
        status: order.status,
        totalJMD: order.total,
        email: (order.user?.email || "").toLowerCase(),
        customerName: order.user?.name || null,
        items: order.items.map((it) => ({
          name: it.product?.name || it.productId,
          size: it.size,
          qty: it.quantity,
          priceJMD: it.unitPrice,
        })),
        history: (Array.isArray(order.history) ? order.history : []).map((h) => ({
          id: h.id,
          at: h.createdAt,
          from: h.fromStatus,
          to: h.toStatus,
          by: h.actor ? (h.actor.name ? `${h.actor.name} (${h.actor.email})` : h.actor.email) : "admin",
          note: h.note || null,
        })),
      },
    });
  } catch (err) {
    console.error("GET /api/admin/orders/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load order" });
  }
});

// ADMIN: update status + write history row
app.patch("/api/admin/orders/:id/status", async (req, res) => {
  const sess = requireAdmin(req, res);
  if (!sess) return;

  const id = String(req.params.id || "").trim();
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();

  if (!id) return res.status(400).json({ ok: false, error: "Missing order id" });
  if (!nextStatus) return res.status(400).json({ ok: false, error: "Missing status" });

  const allowed = new Set(["placed", "processing", "shipped", "delivered", "cancelled"]);
  if (!allowed.has(nextStatus)) {
    return res.status(400).json({ ok: false, error: "Invalid status" });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

    const prev = String(order.status || "placed").toLowerCase();
    if (prev === nextStatus) return res.json({ ok: true, order });

    const updated = await prisma.order.update({
      where: { id },
      data: { status: nextStatus },
    });

    try {
      if (prisma.orderStatusHistory?.create) {
        await prisma.orderStatusHistory.create({
          data: {
            orderId: id,
            actorId: sess.userId,
            fromStatus: prev,
            toStatus: nextStatus,
          },
        });
      }
    } catch (historyErr) {
      console.warn("Order status history write skipped:", historyErr?.message || historyErr);
    }

    return res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("PATCH /api/admin/orders/:id/status failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to update status" });
  }
});


// -----------------------------
// ORDERS (MVP)
// -----------------------------
app.post("/api/orders", async (req, res) => {
  const sess = requireUser(req, res);
  if (!sess) return;

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

  try {
    const order = await prisma.$transaction(async (tx) => {
      await cleanupExpiredReservations(tx);

      let items = rawItems
        .map((it) => ({
          productId: String(it?.productId || "").trim(),
          size: String(it?.size || "").trim().toUpperCase(),
          quantity: parseQty(it?.quantity ?? it?.qty),
        }))
        .filter((it) => it.productId && it.size && it.quantity > 0);

      if (!items.length) {
        const cartRows = await tx.cartItem.findMany({ where: { userId: sess.userId } });
        items = cartRows
          .map((it) => ({ productId: it.productId, size: String(it.size || '').toUpperCase(), quantity: parseQty(it.qty) }))
          .filter((it) => it.productId && it.size && it.quantity > 0);
      }

      if (!items.length) {
        const err = new Error('CART_EMPTY');
        err.code = 'CART_EMPTY';
        throw err;
      }

      const productIds = Array.from(new Set(items.map((i) => i.productId)));
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, priceJMD: true, isPublished: true, name: true },
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      const outOfStock = [];
      for (const it of items) {
        const p = productById.get(it.productId);
        if (!p || !p.isPublished) {
          outOfStock.push({ productId: it.productId, size: it.size, available: 0, reason: 'NOT_FOUND' });
          continue;
        }

        const available = await getAvailableStock(tx, { productId: it.productId, size: it.size, userId: sess.userId });
        if (available < it.quantity) {
          outOfStock.push({ productId: it.productId, size: it.size, available });
        }
      }

      if (outOfStock.length) {
        const err = new Error('OUT_OF_STOCK');
        err.code = 'OUT_OF_STOCK';
        err.details = outOfStock;
        throw err;
      }

      for (const it of items) {
        const updated = await tx.inventory.updateMany({
          where: { productId: it.productId, size: it.size, stock: { gte: it.quantity } },
          data: { stock: { decrement: it.quantity } },
        });

        if (updated.count !== 1) {
          const inv2 = await tx.inventory.findUnique({ where: { productId_size: { productId: it.productId, size: it.size } }, select: { stock: true } });
          const err = new Error('OUT_OF_STOCK');
          err.code = 'OUT_OF_STOCK';
          err.details = [{ productId: it.productId, size: it.size, available: Number(inv2?.stock || 0) }];
          throw err;
        }
      }

      const orderItems = items.map((it) => {
        const p = productById.get(it.productId);
        return {
          productId: it.productId,
          size: it.size,
          quantity: it.quantity,
          unitPrice: Number(p?.priceJMD || 0),
        };
      });

      const subtotal = orderItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);
      const total = subtotal;

      const created = await tx.order.create({
        data: {
          userId: sess.userId,
          subtotal,
          total,
          currency: 'JMD',
          status: 'placed',
          items: { create: orderItems },
        },
        select: { id: true, subtotal: true, total: true, currency: true, status: true, createdAt: true },
      });

      if (tx.orderStatusHistory) {
        await tx.orderStatusHistory.create({
          data: { orderId: created.id, actorId: sess.userId, fromStatus: 'cart', toStatus: 'placed', note: 'Order placed from checkout' },
        });
      }

      await tx.cartItem.deleteMany({ where: { userId: sess.userId } });
      await tx.inventoryReservation.deleteMany({ where: { userId: sess.userId } });

      return created;
    });

    return res.status(201).json({ ok: true, order, orderId: order.id });
  } catch (err) {
    if (err?.code === 'CART_EMPTY') {
      return res.status(400).json({ ok: false, error: 'Cart is empty' });
    }
    if (err?.code === 'OUT_OF_STOCK') {
      return res.status(409).json({ ok: false, code: 'OUT_OF_STOCK', items: err.details || [] });
    }
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to create order' });
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

app.delete("/api/admin/products/:id", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = String(req.params?.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'Missing product id' });

  try {
    await prisma.product.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ ok: false, error: 'Product not found' });
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to delete product' });
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

// -----------------------------
// API SAFETY: JSON 404 + JSON 500
// (Prevents users from seeing platform/proxy HTML on API failures.)
// -----------------------------
app.use((err, req, res, next) => {
  try {
    if (req && typeof req.path === "string" && req.path.startsWith("/api/")) {
      console.error("API error:", err);
      if (res.headersSent) return next(err);
      return res.status(500).json({ ok: false, error: "Server error. Please try again." });
    }
  } catch (_) { }
  return next(err);
});

// Any unknown /api route => JSON 404
app.use("/api", (req, res) => {
  return res.status(404).json({ ok: false, error: "Not found" });
});

const clientDir = path.join(projectRoot, "client");
const uploadsDir = path.join(CLIENT_DIR, "uploads");

app.use("/uploads", express.static(uploadsDir));

// Static files (this comes AFTER admin gate middleware on purpose)

// -----------------------------
// Clean URLs: remove .html in production
// - Redirect /page.html -> /page
// - Serve /page -> /page.html when it exists
// -----------------------------
app.use((req, res, next) => {
  try {
    if (!req.path || typeof req.path !== 'string') return next();
    // Never touch APIs or admin pages (admin login uses explicit .html paths).
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
    // Ignore static assets (has a file extension)
    const hasExt = /\.[a-zA-Z0-9]+$/.test(req.path);
    if (hasExt) {
      // Redirect .html -> clean
      if (req.path.toLowerCase().endsWith('.html')) {
        const clean = req.path.slice(0, -5) || '/';
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(301, clean + qs);
      }
      return next();
    }
    // If path already ends with '/', let static / index handling continue
    // Attempt to serve matching .html file
    const filePath = path.join(clientDir, req.path + '.html');
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  } catch (_) { }
  return next();
});

// -----------------------------
// CLEAN URLS (no .html in production)
// - /shop-page -> /shop-page.html (if exists)
// - /cart -> /cart.html, etc.
// -----------------------------
app.get(/^\/(?!api\/|admin\/)([^.\/]+)\/?$/, (req, res, next) => {
  try {
    const name = String(req.params[0] || '').trim();
    if (!name) return next();
    const file = path.join(clientDir, `${name}.html`);
    if (fs.existsSync(file)) return res.sendFile(file);
  } catch (_) { }
  return next();
});

app.use(express.static(CLIENT_DIR));


app.use((req, res, next) => {

  // Ignore API routes
  if (req.path.startsWith("/api")) {
    return next();
  }

  // Ignore asset directories
  if (
    req.path.startsWith("/images") ||
    req.path.startsWith("/css") ||
    req.path.startsWith("/js") ||
    req.path.startsWith("/assets")
  ) {
    return next();
  }

  // Ignore requests that already include file extensions
  if (req.path.includes(".")) {
    return next();
  }

  const filePath = path.join(CLIENT_DIR, `${req.path}.html`);

  res.sendFile(filePath, (err) => {
    if (err) next();
  });

});
// Friendly route aliases
app.get('/home', (req, res) => res.sendFile(path.join(clientDir, 'index.html')));
app.get('/shop', (req, res) => res.sendFile(path.join(clientDir, 'shop-page.html')));
app.get('/cart', (req, res) => res.sendFile(path.join(clientDir, 'cart.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(clientDir, 'checkout.html')));
app.get('/account', (req, res) => res.sendFile(path.join(clientDir, 'account.html')));
app.get('/orders', (req, res) => res.sendFile(path.join(clientDir, 'orders.html')));
app.get('/receipt', (req, res) => res.sendFile(path.join(clientDir, 'receipt.html')));
app.get('/login', (req, res) => res.sendFile(path.join(clientDir, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(clientDir, 'register.html')));
app.get('/about', (req, res) => res.sendFile(path.join(clientDir, 'About.html')));
app.get('/edit-profile', (req, res) => res.sendFile(path.join(clientDir, 'edit-profile.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(clientDir, 'forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(clientDir, 'reset-password.html')));

// Serve homepage
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "index.html")));

app.listen(PORT, () => {
  console.log(`Beyond Silhouette server running on http://localhost:${PORT}`);
});
// -----------------------------
// API 404 + Error handling (JSON only)
// -----------------------------
app.use('/api', (req, res, next) => {
  // If we reach here, no /api route matched.
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.use((err, req, res, next) => {
  // Ensure API never returns HTML/platform pages.
  if (req.path && req.path.startsWith('/api')) {
    console.error('API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
  next(err);
});
