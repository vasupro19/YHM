require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// safe to run again: roles are looked up by name, never deleted
const roles = ["ADMIN", "CLIENT"];

const seedRoles = async () => {
  try {
    console.log("Running Role Seeder...");
    for (const name of roles) {
      const found = await prisma.role.findFirst({ where: { name } });
      if (!found) await prisma.role.create({ data: { name } });
    }
    console.log("Roles ready.");
  } catch (error) {
    console.error("Error seeding roles:", error.message);
  } finally {
    await prisma.$disconnect();
    process.exit();
  }
};

seedRoles();
