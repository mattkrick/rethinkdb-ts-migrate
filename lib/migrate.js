"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = exports.down = exports.up = void 0;
const tslib_1 = require("tslib");
const path = tslib_1.__importStar(require("path"));
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const nconf_1 = tslib_1.__importDefault(require("nconf"));
const fs_1 = require("fs");
const rethinkdb_ts_1 = require("rethinkdb-ts");
const moment_1 = tslib_1.__importDefault(require("moment"));
require('sucrase/register');
const MIGRATION_TABLE_NAME = '_migrations';
const rxMigrationFile = /^\d{14}-.*\.(js|ts)$/;
const getConfig = async (root) => {
    nconf_1.default
        .argv()
        .env()
        .file({ file: path.join(root, 'database.json') });
    return {
        host: nconf_1.default.get('host'),
        port: nconf_1.default.get('port'),
        user: nconf_1.default.get('user') || 'admin',
        password: nconf_1.default.get('password') || '',
        db: nconf_1.default.get('db'),
        discovery: Boolean(nconf_1.default.get('discovery')) || false,
        timeout: nconf_1.default.get('timeout') || 5 * 60,
        authKey: nconf_1.default.get('authKey'),
        ssl: nconf_1.default.get('ssl'),
    };
};
/*
  Connect to db
  If db does not yet exist, create it
 */
async function connectToDb(config) {
    await rethinkdb_ts_1.r.connectPool(config);
    const dbs = await rethinkdb_ts_1.r.dbList().run();
    if (!dbs.includes(config.db)) {
        await rethinkdb_ts_1.r.dbCreate(config.db).run();
    }
    const tables = await rethinkdb_ts_1.r.tableList().run();
    if (!tables.includes(MIGRATION_TABLE_NAME)) {
        await rethinkdb_ts_1.r.tableCreate(MIGRATION_TABLE_NAME).run();
        await rethinkdb_ts_1.r
            .table(MIGRATION_TABLE_NAME)
            .indexCreate('timestamp')
            .run();
        await rethinkdb_ts_1.r
            .table(MIGRATION_TABLE_NAME)
            .indexWait()
            .run();
    }
    await rethinkdb_ts_1.r
        .db(config.db)
        .wait({ waitFor: 'ready_for_writes' })
        .run();
}
/*
  Compares completed migrations to files on disk
  Returns the migrations scripts with a timestamp newer than last
  completed migration in db.

  TODO: Change so that all non run migration scripts are returned
 */
async function getMigrationsExcept(completedMigration, root, numToApply) {
    const dir = path.join(root, 'migrations');
    const files = await fs_1.promises.readdir(dir);
    const migrationFiles = files.filter((file) => file.match(rxMigrationFile));
    const migrations = migrationFiles
        .map((filename) => {
        const tsix = filename.indexOf('-');
        return {
            name: filename.substring(tsix + 1, filename.lastIndexOf('.')),
            timestamp: filename.substring(0, tsix),
            filename: filename,
        };
    })
        .filter((migration) => {
        return completedMigration ? migration.timestamp > completedMigration.timestamp : true;
    });
    const migrationsToApply = numToApply !== -1 ? migrations.slice(0, numToApply) : migrations;
    const codes = await Promise.all(migrationsToApply.map((migration) => require(path.join(dir, migration.filename))));
    return migrationsToApply.map((migration, idx) => ({
        ...migration,
        code: codes[idx],
    }));
}
/*
  Takes a list of migration file paths and requires them
 */
function requireMigrations(migrations, root) {
    return migrations.map(function (migration) {
        const filename = migration.timestamp + '-' + migration.name;
        const filepath = path.join(root, 'migrations', filename);
        return {
            ...migration,
            filename,
            code: require(filepath),
        };
    });
}
async function up(params) {
    const { all, root } = params;
    const rootDir = root || process.cwd();
    await connectToDb(await getConfig(rootDir));
    const completedMigrations = await rethinkdb_ts_1.r
        .table(MIGRATION_TABLE_NAME)
        .orderBy({ index: 'timestamp' })
        .run();
    const latest = completedMigrations[completedMigrations.length - 1];
    const numToApply = all ? -1 : 1;
    const migrations = await getMigrationsExcept(latest, rootDir, numToApply);
    if (migrations.length < 1) {
        logInfo('No new migrations');
        return;
    }
    for (let i = 0; i < migrations.length; i++) {
        const migration = migrations[i];
        logInfo(chalk_1.default.black.bgGreen(' ↑  up  ↑ '), migration.timestamp, chalk_1.default.yellow(migration.name));
        const { name, timestamp } = migration;
        try {
            await migration.code.up(rethinkdb_ts_1.r);
        }
        catch (e) {
            logError(`Migration failed: ${name}`, e);
            return;
        }
        await rethinkdb_ts_1.r
            .table(MIGRATION_TABLE_NAME)
            .insert({ name, timestamp })
            .run();
    }
    logInfo('Migration Successful');
    await rethinkdb_ts_1.r.getPoolMaster()?.drain();
}
exports.up = up;
/*
  Rollback one or all migrations
 */
async function down(params) {
    const { all, root } = params;
    const rootDir = root || process.cwd();
    await connectToDb(await getConfig(rootDir));
    const completedMigrations = await rethinkdb_ts_1.r
        .table(MIGRATION_TABLE_NAME)
        .orderBy({ index: 'timestamp' })
        .run();
    if (completedMigrations.length === 0) {
        logInfo('No new migrations');
        return;
    }
    const migrationsToRollBack = all
        ? completedMigrations.reverse()
        : [completedMigrations[completedMigrations.length - 1]];
    const migrations = requireMigrations(migrationsToRollBack, rootDir);
    for (let i = 0; i < migrations.length; i++) {
        const migration = migrations[i];
        logInfo(chalk_1.default.black.bgYellow(' ↓ down ↓ '), migration.timestamp, chalk_1.default.yellow(migration.name));
        const { name } = migration;
        try {
            await migration.code.down(rethinkdb_ts_1.r);
        }
        catch (e) {
            logError(`Migration failed: ${name}`, e);
            return;
        }
        await rethinkdb_ts_1.r
            .table(MIGRATION_TABLE_NAME)
            .get(migration.id)
            .delete()
            .run();
    }
    logInfo('Migration successful');
    await rethinkdb_ts_1.r.getPoolMaster()?.drain();
}
exports.down = down;
function logInfo(...args) {
    args.unshift(chalk_1.default.blue('[migrate-rethinkdb]'));
    console.log(args.join(' '));
}
function logError(txt, error) {
    console.error(chalk_1.default.red('[migrate-rethinkdb] ') + txt);
    if (error) {
        console.error(error);
        if (error.stack) {
            console.error(error.stack);
        }
    }
}
async function create(name, root) {
    const rootDir = path.join(root || process.cwd(), 'migrations');
    const templatepath = path.join(__dirname, '../template.ts');
    const filename = moment_1.default().format('YYYYMMDDHHmmss') + '-' + name + '.ts';
    const filepath = path.join(rootDir, filename);
    await fs_1.promises.copyFile(templatepath, filepath);
    return filepath;
}
exports.create = create;
//# sourceMappingURL=migrate.js.map