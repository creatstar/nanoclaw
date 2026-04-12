#!/usr/bin/env node
/**
 * Set the Claude model for a group's container config.
 *
 * Usage:
 *   node scripts/set-group-model.js <folder-pattern> <model>
 *
 * Examples:
 *   node scripts/set-group-model.js telegram% claude-opus-4-6
 *   node scripts/set-group-model.js whatsapp_main claude-sonnet-4-6
 */

const Database = require('better-sqlite3');
const path = require('path');

const [, , folderPattern, model] = process.argv;

if (!folderPattern || !model) {
  console.error('Usage: node scripts/set-group-model.js <folder-pattern> <model>');
  console.error('Example: node scripts/set-group-model.js telegram% claude-opus-4-6');
  process.exit(1);
}

const dbPath = path.join(__dirname, '..', 'store', 'messages.db');
const db = new Database(dbPath);

const rows = db
  .prepare('SELECT jid, name, folder, container_config FROM registered_groups WHERE folder LIKE ?')
  .all(folderPattern);

if (rows.length === 0) {
  console.error(`No groups found matching folder pattern "${folderPattern}"`);
  process.exit(1);
}

const update = db.prepare(
  'UPDATE registered_groups SET container_config = ? WHERE jid = ?',
);

for (const row of rows) {
  const config = row.container_config ? JSON.parse(row.container_config) : {};
  config.model = model;
  update.run(JSON.stringify(config), row.jid);
  console.log(`${row.folder} (${row.name}): model set to ${model}`);
}

db.close();
console.log(`\nDone. Restart nanoclaw for changes to take effect.`);
