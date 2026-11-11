const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Logger = require("../Helpers/logger");
const Response = require("../Helpers/response.helper");
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

async function createNewDatabase(dbName) {
  try {
    const connection = await mysql.createConnection({
      ...parseHost(process.env.DB_HOST),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.end();
    Logger.info("Database created successfully " + dbName);
    return true;
  } catch (error) {
    Logger.error(
      "Error creating database or running migration:",
      error.message
    );
    return false;
  }
}

async function runMigrationForDatabase(dbName) {
  try {
    const baseSchemaPath = "prisma/newDb/schema.prisma";
    const tempSchemaDir = `prisma/temp/${dbName}`;
    const tempSchemaPath = `${tempSchemaDir}/schema.prisma`;

    // Ensure temp folder exists
    fs.mkdirSync(tempSchemaDir, { recursive: true });

    // Copy base schema
    fs.copyFileSync(baseSchemaPath, tempSchemaPath);
    fs.cpSync("prisma/newDb/migrations", `${tempSchemaDir}/migrations`, {
      recursive: true,
    });

    // Prepare DB URL
    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS;
    const dbHost = process.env.DB_HOST;
    const dbUrl = `mysql://${dbUser}:${dbPass}@${dbHost}/${dbName}`;

    // Run migration with dynamic DATABASE_URL
    execSync(`npx prisma migrate deploy --schema=${tempSchemaPath}`, {
      env: {
        ...process.env,
        NEW_DATABASE_URL: dbUrl,
      },
      stdio: "inherit",
    });

    Logger.info(`Database Migration deployed for ${dbName}`);
  } catch (error) {
    Logger.error(
      "Error creating database or running migration: " + error.message
    );
  }
}

function parseHost(hostValue) {
  const [host, port] = String(hostValue || "localhost").split(":");
  return { host, port: port ? Number(port) : 3306 };
}

// one pool per tenant database, shared by every request
const tenantPools = new Map();

async function getDynamicConnectionForDatabase(dbName) {
  let pool = tenantPools.get(dbName);
  if (!pool) {
    pool = mysql.createPool({
      ...parseHost(process.env.DB_HOST),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASS || "",
      database: dbName,
      connectionLimit: 10,
      dateStrings: ['DATE'], // DATE columns come back as 'YYYY-MM-DD', never shifted by timezone
      decimalNumbers: true,
    });
    tenantPools.set(dbName, pool);
  }
  // controllers call end() when done; the pool stays open, so end() is a no-op
  return {
    query: (...args) => pool.query(...args),
    execute: (...args) => pool.execute(...args),
    end: async () => {},
    // runs fn(conn) inside one transaction; rolls back if fn throws
    transaction: async (fn) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },
  };
}

module.exports = {
  createNewDatabase,
  runMigrationForDatabase,
  getDynamicConnectionForDatabase,
};
