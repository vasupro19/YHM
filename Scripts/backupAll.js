// Backs up the main database and every hotel's database to compressed files.
//   node Scripts/backupAll.js
// Settings (env): BACKUP_DIR (default ./backups), BACKUP_KEEP_DAYS (default 14), MYSQLDUMP_BIN (default mysqldump).
// Run it every night from cron, for example:  30 2 * * *  cd /path/to/backend && node Scripts/backupAll.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { PrismaClient } = require('@prisma/client');

const [host, port = '3306'] = String(process.env.DB_HOST || 'localhost').split(':');
const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 14);
const bin = (process.env.MYSQLDUMP_BIN || 'mysqldump').split(' ');

const dump = (db, file) =>
  new Promise((resolve, reject) => {
    const args = [...bin.slice(1), '-h', host, '-P', port, '-u', process.env.DB_USER || 'root', '--single-transaction', '--routines', '--no-tablespaces', db];
    const child = spawn(bin[0], args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASS || '' } });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    const out = fs.createWriteStream(file);
    child.stdout.pipe(zlib.createGzip()).pipe(out);
    child.on('error', reject);
    out.on('finish', () => (child.exitCode === 0 || child.exitCode === null ? resolve() : reject(new Error(err || `mysqldump exited with ${child.exitCode}`))));
    child.on('close', (code) => code !== 0 && reject(new Error(err || `mysqldump exited with ${code}`)));
  });

(async () => {
  const prisma = new PrismaClient();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const target = path.join(dir, stamp);
  fs.mkdirSync(target, { recursive: true });

  const main = (await prisma.$queryRaw`SELECT DATABASE() AS name`)[0].name;
  const names = [main, ...(await prisma.client.findMany({ select: { code: true } })).map((c) => c.code)];
  let failed = 0;
  for (const name of names) {
    try {
      await dump(name, path.join(target, `${name}.sql.gz`));
      console.log(`ok     ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`FAILED ${name}: ${e.message}`);
    }
  }

  // remove backup folders older than the retention period
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const full = path.join(dir, d);
    if (fs.statSync(full).isDirectory() && Date.now() - fs.statSync(full).mtimeMs > keepDays * 86400000) fs.rmSync(full, { recursive: true, force: true });
  }
  await prisma.$disconnect();
  console.log(`${names.length - failed}/${names.length} databases backed up to ${target}`);
  process.exit(failed ? 1 : 0);
})();
