import { createHash } from 'node:crypto';
import { execFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const WORKSPACE_ID = 'fbffb30c-9091-432f-9e09-9c59e1440304';
const IMAGE = 'postgres:17-alpine';
const BACKUP_DATABASE_NAME = 'pivnik_backup_20260804_pre_unification';
const DATABASES = {
  telegramCanonical: 'beb858e1-c412-42b8-b570-bda36ca82b59',
  vkLegacy: 'de5da1be-76c1-4976-a88c-efcce93600e6'
};

function railway(args) {
  return execFileSync('railway', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024
  });
}

function parseVariables(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return Object.fromEntries(parsed.map((item) => [item.name ?? item.key, item.value ?? '']));
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.variables && typeof parsed.variables === 'object') return parsed.variables;
    return parsed;
  }
  return {};
}

function redact(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/(password|secret|token)(["'\s:=]+)[^\s,"'<>]+/gi, '$1$2[REDACTED]')
    .slice(0, 12_000);
}

function runDocker(env, script, mounts = []) {
  const args = ['run', '--rm'];
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }
  for (const mount of mounts) {
    args.push('-v', mount);
  }
  args.push(IMAGE, 'sh', '-lc', script);

  const child = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024
  });
  if (child.status !== 0) {
    throw new Error(redact(child.stderr || child.stdout || `docker exited with ${child.status}`));
  }
  return String(child.stdout || '').trim();
}

function databaseUrlFor(sourceUrl, databaseName) {
  const url = new URL(sourceUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function safeServerFingerprint(sourceUrl) {
  const url = new URL(sourceUrl);
  return createHash('sha256').update(`${url.hostname}:${url.port}`).digest('hex').slice(0, 16);
}

railway([
  'link',
  '--project', PROJECT_ID,
  '--environment', ENVIRONMENT_ID,
  '--workspace', WORKSPACE_ID,
  '--json'
]);

// Pull once before the first database operation so tool availability is deterministic.
runDocker({}, 'pg_dump --version >/dev/null && pg_restore --version >/dev/null');

const results = {};

for (const [label, serviceId] of Object.entries(DATABASES)) {
  const vars = parseVariables(railway([
    'variable', 'list',
    '--service', serviceId,
    '--environment', ENVIRONMENT_ID,
    '--json'
  ]));
  const sourceUrl = String(vars.DATABASE_PUBLIC_URL || '').trim();
  if (!sourceUrl) throw new Error(`${label}: DATABASE_PUBLIC_URL is not configured.`);

  const sourceDatabaseName = new URL(sourceUrl).pathname.replace(/^\//, '') || 'railway';
  if (sourceDatabaseName === BACKUP_DATABASE_NAME) {
    throw new Error(`${label}: source and backup database names are identical.`);
  }

  const backupUrl = databaseUrlFor(sourceUrl, BACKUP_DATABASE_NAME);
  const workdir = mkdtempSync(join(tmpdir(), `pivnik-${label}-`));
  const dumpPath = join(workdir, 'source.dump');
  let created = false;

  try {
    const sourceSizeBytes = Number(runDocker(
      { SOURCE_DATABASE_URL: sourceUrl },
      `psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT pg_database_size(current_database())"`
    ));
    if (!Number.isFinite(sourceSizeBytes) || sourceSizeBytes <= 0) {
      throw new Error(`${label}: could not determine source database size.`);
    }
    // Both Railway volumes are 500 MB. Keep a conservative guard before duplication.
    if (sourceSizeBytes > 200 * 1024 * 1024) {
      throw new Error(`${label}: source database is too large for the guarded internal backup.`);
    }

    const existing = runDocker(
      { SOURCE_DATABASE_URL: sourceUrl, BACKUP_DATABASE_NAME },
      `psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT 1 FROM pg_database WHERE datname = '$BACKUP_DATABASE_NAME'"`
    ) === '1';

    let validExisting = false;
    if (existing) {
      try {
        validExisting = runDocker(
          { BACKUP_DATABASE_URL: backupUrl },
          `psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT CASE WHEN to_regclass('public.pivnik_backup_metadata') IS NULL THEN 0 ELSE 1 END"`
        ) === '1';
      } catch {
        validExisting = false;
      }
    }

    if (!validExisting) {
      if (existing) {
        runDocker(
          { SOURCE_DATABASE_URL: sourceUrl, BACKUP_DATABASE_NAME },
          `dropdb --if-exists --force --maintenance-db="$SOURCE_DATABASE_URL" "$BACKUP_DATABASE_NAME"`
        );
      }

      runDocker(
        { SOURCE_DATABASE_URL: sourceUrl, BACKUP_DATABASE_NAME },
        `createdb --maintenance-db="$SOURCE_DATABASE_URL" "$BACKUP_DATABASE_NAME"`
      );
      created = true;

      runDocker(
        { SOURCE_DATABASE_URL: sourceUrl },
        `pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-privileges --file=/backup/source.dump`,
        [`${workdir}:/backup`]
      );

      runDocker(
        {},
        `pg_restore --list /backup/source.dump >/dev/null`,
        [`${workdir}:/backup`]
      );

      runDocker(
        { BACKUP_DATABASE_URL: backupUrl },
        `pg_restore --exit-on-error --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL" /backup/source.dump`,
        [`${workdir}:/backup`]
      );

      runDocker(
        {
          BACKUP_DATABASE_URL: backupUrl,
          SOURCE_DATABASE_NAME: sourceDatabaseName,
          RELEASE_COMMIT: String(process.env.GITHUB_SHA || 'unknown')
        },
        `psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.pivnik_backup_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  source_database text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  release_commit text NOT NULL
);
INSERT INTO public.pivnik_backup_metadata(singleton, source_database, release_commit)
VALUES (true, :'SOURCE_DATABASE_NAME', :'RELEASE_COMMIT')
ON CONFLICT (singleton) DO UPDATE
SET source_database = EXCLUDED.source_database,
    release_commit = EXCLUDED.release_commit;
SQL`,
        []
      );
    }

    const verification = runDocker(
      { BACKUP_DATABASE_URL: backupUrl },
      `psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F '|' -c "SELECT pg_database_size(current_database()), (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'), (SELECT count(*) FROM public.pivnik_backup_metadata)"`
    ).split('|');

    const backupSizeBytes = Number(verification[0]);
    const publicTableCount = Number(verification[1]);
    const metadataRows = Number(verification[2]);
    if (!Number.isFinite(backupSizeBytes) || publicTableCount < 1 || metadataRows !== 1) {
      throw new Error(`${label}: internal backup verification failed.`);
    }

    const dumpSha256 = created
      ? createHash('sha256').update(readFileSync(dumpPath)).digest('hex')
      : null;

    results[label] = {
      ok: true,
      created,
      backupDatabase: BACKUP_DATABASE_NAME,
      serverFingerprint: safeServerFingerprint(sourceUrl),
      sourceSizeBytes,
      backupSizeBytes,
      publicTableCount,
      metadataRows,
      dumpSha256
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, backups: results }, null, 2));
