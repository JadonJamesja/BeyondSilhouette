-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_home_settings" (
    "id" TEXT NOT NULL,
    "headline" TEXT,
    "subheadline" TEXT,
    "slideshowUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featuredProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_home_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_config" (
    "id" TEXT NOT NULL,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_userId_productId_size_key"
ON "cart_items"("userId", "productId", "size");

CREATE INDEX "cart_items_userId_idx"
ON "cart_items"("userId");

CREATE INDEX "cart_items_productId_size_idx"
ON "cart_items"("productId", "size");

CREATE UNIQUE INDEX "inventory_reservations_userId_productId_size_key"
ON "inventory_reservations"("userId", "productId", "size");

CREATE INDEX "inventory_reservations_userId_idx"
ON "inventory_reservations"("userId");

CREATE INDEX "inventory_reservations_productId_size_idx"
ON "inventory_reservations"("productId", "size");

CREATE INDEX "inventory_reservations_expiresAt_idx"
ON "inventory_reservations"("expiresAt");

-- AddForeignKey
ALTER TABLE "cart_items"
ADD CONSTRAINT "cart_items_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cart_items"
ADD CONSTRAINT "cart_items_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_reservations"
ADD CONSTRAINT "inventory_reservations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_reservations"
ADD CONSTRAINT "inventory_reservations_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id")
ON DELETE CASCADE ON UPDATE CASCADE;