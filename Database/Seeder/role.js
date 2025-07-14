require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Seeder data
const roles = [{ name: "ADMIN" }, { name: "CLIENT" }];

const seedRoles = async () => {
  try {
    console.log("Running Role Seeder...");

    // Clear existing data
    await prisma.role.deleteMany();
    console.log("Existing roles cleared.");

    // Insert new data
    await prisma.role.createMany({ data: roles });
    console.log("Roles seeded successfully!");
  } catch (error) {
    console.error("Error seeding roles:", error.message);
  } finally {
    await prisma.$disconnect();
    process.exit();
  }
};

seedRoles();
