import { PrismaClient } from "@prisma/client";

// Prisma Client singleton (ESM-safe)
// Prevents creating multiple clients during hot reload / nodemon restarts.
const globalForPrisma = globalThis;

/** @type {PrismaClient} */
export const prisma =
    globalForPrisma.__bs_prisma__ ||
    new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__bs_prisma__ = prisma;
}

export default prisma;
