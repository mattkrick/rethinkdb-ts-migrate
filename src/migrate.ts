import * as path from 'path'
import chalk from 'chalk'
import nconf from 'nconf'
import {promises as fs} from 'fs'
import {r, R} from 'rethinkdb-ts'
import moment from 'moment'

require('sucrase/register')

const MIGRATION_TABLE_NAME = '_migrations'
const rxMigrationFile = /^\d{14}-.*\.(js|ts)$/
type MigrationFn = (r: R) => void

interface MigrationFile {
  up: MigrationFn
  down: MigrationFn
}

/*
  Read config from
  - arguments
  - environment variables
  - /database.json
 */
type Unpromise<T> = T extends (...args: any[]) => Promise<infer U> ? U : T

const getConfig = async (root: string) => {
  nconf
    .argv()
    .env()
    .file({file: path.join(root, 'database.json')})
  return {
    host: nconf.get('host'),
    port: nconf.get('port'),
    user: nconf.get('user') || 'admin',
    password: nconf.get('password') || '',
    db: nconf.get('db'),
    discovery: Boolean(nconf.get('discovery')) || false,
    timeout: nconf.get('timeout') || 5 * 60,
    authKey: nconf.get('authKey'),
    ssl: nconf.get('ssl'),
  }
}
type Config = Unpromise<typeof getConfig>

/*
  Connect to db
  If db does not yet exist, create it
 */
async function connectToDb(config: Config) {
  await r.connectPool(config)
  const dbs = await r.dbList().run()
  if (!dbs.includes(config.db)) {
    await r.dbCreate(config.db).run()
  }
  const tables = await r.tableList().run()
  if (!tables.includes(MIGRATION_TABLE_NAME)) {
    await r.tableCreate(MIGRATION_TABLE_NAME).run()
    await r
      .table(MIGRATION_TABLE_NAME)
      .indexCreate('timestamp')
      .run()
    await r
      .table(MIGRATION_TABLE_NAME)
      .indexWait()
      .run()
  }
  await r
    .db(config.db)
    .wait({waitFor: 'ready_for_writes'})
    .run()
}

/*
  Compares completed migrations to files on disk
  Returns the migrations scripts with a timestamp newer than last
  completed migration in db.

  TODO: Change so that all non run migration scripts are returned
 */
async function getMigrationsExcept(
  completedMigration: Migration | undefined,
  root: string,
  numToApply: -1 | 1,
) {
  const dir = path.join(root, 'migrations')
  const files = await fs.readdir(dir)
  const migrationFiles = files.filter((file) => file.match(rxMigrationFile))
  const migrations = migrationFiles
    .map((filename) => {
      const tsix = filename.indexOf('-')
      return {
        name: filename.substring(tsix + 1, filename.lastIndexOf('.')),
        timestamp: filename.substring(0, tsix),
        filename: filename,
      }
    })
    .filter((migration) => {
      return completedMigration ? migration.timestamp > completedMigration.timestamp : true
    })
  const migrationsToApply = numToApply !== -1 ? migrations.slice(0, numToApply) : migrations
  const codes = await Promise.all(
    migrationsToApply.map(
      (migration) => require(path.join(dir, migration.filename)) as MigrationFile,
    ),
  )
  return migrationsToApply.map((migration, idx) => ({
    ...migration,
    code: codes[idx],
  }))
}

/*
  Takes a list of migration file paths and requires them
 */
function requireMigrations(migrations: Migration[], root: string) {
  return migrations.map(function(migration) {
    const filename = migration.timestamp + '-' + migration.name
    const filepath = path.join(root, 'migrations', filename)
    return {
      ...migration,
      filename,
      code: require(filepath) as MigrationFile,
    }
  })
}

/*
  Run all new up migrations
 */

interface Params {
  root?: string
  all?: boolean
}

interface Migration {
  id: string
  name: string
  timestamp: string
}

export async function up(params: Params) {
  const {all, root} = params
  const rootDir = root || process.cwd()
  await connectToDb(await getConfig(rootDir))
  const completedMigrations = await r
    .table<Migration>(MIGRATION_TABLE_NAME)
    .orderBy({index: 'timestamp'})
    .run()
  const latest = completedMigrations[completedMigrations.length - 1]
  const numToApply = all ? -1 : 1
  const migrations = await getMigrationsExcept(latest, rootDir, numToApply)
  if (migrations.length < 1) {
    logInfo('No new migrations')
    return
  }
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]
    logInfo(chalk.black.bgGreen(' ↑  up  ↑ '), migration.timestamp, chalk.yellow(migration.name))
    const {name, timestamp} = migration
    try {
      await migration.code.up(r)
    } catch (e) {
      logError(`Migration failed: ${name}`, e)
      return
    }
    await r
      .table(MIGRATION_TABLE_NAME)
      .insert({name, timestamp})
      .run()
  }
  logInfo('Migration Successful')
}

/*
  Rollback one or all migrations
 */
export async function down(params: Params) {
  const {all, root} = params
  const rootDir = root || process.cwd()
  await connectToDb(await getConfig(rootDir))
  const completedMigrations = await r
    .table<Migration>(MIGRATION_TABLE_NAME)
    .orderBy({index: 'timestamp'})
    .run()
  if (completedMigrations.length === 0) {
    logInfo('No new migrations')
    return
  }
  const migrationsToRollBack = all
    ? completedMigrations.reverse()
    : [completedMigrations[completedMigrations.length - 1]]
  const migrations = requireMigrations(migrationsToRollBack, rootDir)
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]
    logInfo(chalk.black.bgYellow(' ↓ down ↓ '), migration.timestamp, chalk.yellow(migration.name))
    const {name} = migration
    try {
      await migration.code.down(r)
    } catch (e) {
      logError(`Migration failed: ${name}`, e)
      return
    }
    await r
      .table(MIGRATION_TABLE_NAME)
      .get(migration.id)
      .delete()
      .run()
  }
  logInfo('Migration successful')
}

function logInfo(...args: any[]) {
  args.unshift(chalk.blue('[migrate-rethinkdb]'))
  console.log(args.join(' '))
}

function logError(txt: string, error: Error) {
  console.error(chalk.red('[migrate-rethinkdb] ') + txt)
  if (error) {
    console.error(error)
    if (error.stack) {
      console.error(error.stack)
    }
  }
}

export async function create(name: string, root: string) {
  const rootDir = path.join(root || process.cwd(), 'migrations')
  const templatepath = path.join(__dirname, '../template.ts')
  const filename = moment().format('YYYYMMDDHHmmss') + '-' + name + '.ts'
  const filepath = path.join(rootDir, filename)
  await fs.copyFile(templatepath, filepath)
  return filepath
}
