// File: src/lib/prisma.ts

import { PrismaClient } from "@prisma/client";

const createPrismaClient = () =>
  new PrismaClient({
    log: ["error", "warn"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

const existingClient = globalForPrisma.prisma;
const hasLatestModels =
  existingClient &&
  "adminUser" in existingClient &&
  "systemStatus" in existingClient;

export const prisma = hasLatestModels ? existingClient : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;