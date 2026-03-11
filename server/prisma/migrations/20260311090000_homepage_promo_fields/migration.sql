-- Add new homepage CMS fields and migrate previous hero text fields
ALTER TABLE "site_home_settings"
ADD COLUMN "heroTitle" TEXT,
ADD COLUMN "heroSubtitle" TEXT,
ADD COLUMN "promoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "promoImageUrl" TEXT,
ADD COLUMN "promoTitle" TEXT,
ADD COLUMN "promoSubtitle" TEXT,
ADD COLUMN "promoCtaText" TEXT,
ADD COLUMN "promoCtaLink" TEXT;

UPDATE "site_home_settings"
SET
  "heroTitle" = COALESCE("heroTitle", "headline"),
  "heroSubtitle" = COALESCE("heroSubtitle", "subheadline");

ALTER TABLE "site_home_settings"
DROP COLUMN IF EXISTS "headline",
DROP COLUMN IF EXISTS "subheadline";
