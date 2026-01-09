/* Beyond Silhouette — Products Store (local demo)
   - Source of truth for products (for now)
   - Uses localStorage
   - Seeds default products if empty
*/

(() => {
  "use strict";

  const KEY = "bs_products_v1";

  const nowISO = () => new Date().toISOString();
  const uid = (p = "prod_") => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  // ---- Seed products (these replace your old hardcoded cards)
  function seedProducts() {
    const products = [
      mk({
        title: "Classic One-Piece",
        priceJMD: 8500,
        cover: "images/test image 2.jpg",
        totalStock: 12
      }),
      mk({
        title: "High-Waist Bikini",
        priceJMD: 9500,
        cover: "images/test image 1.jpg",
        totalStock: 8
      }),
      mk({
        title: "Strappy Monokini",
        priceJMD: 11000,
        cover: "images/test image 6.jpg",
        totalStock: 5
      }),
      mk({
        title: "Ruffled Bikini",
        priceJMD: 9000,
        cover: "images/test image 3.jpg",
        totalStock: 10
      }),
      mk({
        title: "Sporty Two-Piece",
        priceJMD: 8700,
        cover: "images/test image 5.jpg",
        totalStock: 7
      }),
      mk({
        title: "Cut-Out Monokini",
        priceJMD: 10500,
        cover: "images/test image 4.jpg",
        totalStock: 6
      }),
      mk({
        title: "Fringe Bikini",
        priceJMD: 9200,
        cover: "images/test image 7.jpg",
        totalStock: 9
      }),
      mk({
        title: "Classic Bandeau",
        priceJMD: 8800,
        cover: "images/test image 8.jpg",
        totalStock: 11
      }),
    ];

    // publish all by default for demo
    products.forEach(p => p.status = "published");

    return products;
  }

  function mk({ title, priceJMD, cover, totalStock }) {
    const sizes = ["S", "M", "L", "XL"];
    const split = splitStock(totalStock, sizes);

    return {
      id: uid("prod_"),
      slug: String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      status: "draft", // draft | published | archived
      title,
      description: "",
      priceJMD: Number(priceJMD || 0),
      compareAtJMD: null,
      category: "swimwear",
      tags: [],

      sizes,
      stockBySize: split,

      media: {
        coverImageId: null,           // for later media library
        galleryImageIds: [],
        coverUrl: cover               // local path for now
      },

      isFeatured: false,
      isActive: true,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
  }

  function splitStock(total, sizes) {
    // simple even-ish distribution for demo
    const t = Math.max(0, Number(total || 0));
    const base = Math.floor(t / sizes.length);
    let rem = t % sizes.length;

    const stock = {};
    sizes.forEach((s) => {
      stock[s] = base + (rem > 0 ? 1 : 0);
      rem--;
    });
    return stock;
  }

  function readAll() {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? safeParse(raw) : null;

    if (!Array.isArray(arr) || arr.length === 0) {
      const seeded = seedProducts();
      localStorage.setItem(KEY, JSON.stringify(seeded));
      return seeded;
    }
    return arr;
  }

  function writeAll(products) {
    localStorage.setItem(KEY, JSON.stringify(products || []));
  }

  function listPublished() {
    return readAll().filter(p => p && p.isActive !== false && p.status === "published");
  }

  // Expose a tiny API for main.js (and later admin.js)
  window.BSProducts = {
    key: KEY,
    readAll,
    writeAll,
    listPublished,
  };
})();
