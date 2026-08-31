import { createHash, randomBytes } from 'node:crypto'
import { pool } from '@/lib/db'

/** IDEA-121 — same masking convention as IDEA-119's personal keys
 * (api-keys.ts). */
const VISIBLE_PREFIX_LENGTH = 10
const VISIBLE_SUFFIX_LENGTH = 4

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** `fp_app_` distinguishes an application key from a personal one
 * (`fp_`) at a glance — in a log line or an error report, "which kind of
 * key is this" shouldn't require a database lookup. */
function generateKey(): string {
  return `fp_app_${randomBytes(32).toString('base64url')}`
}

export interface Application {
  id: string
  name: string
  contactName: string
  contactEmail: string
  createdAt: Date
}

interface ApplicationRow {
  id: string
  name: string
  contact_name: string
  contact_email: string
  created_at: Date
}

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
  }
}

/** IDEA-121's Applications screen — every registered application, for the
 * Fabric-Admin-only list. */
export async function listApplications(): Promise<Application[]> {
  const { rows } = await pool.query<ApplicationRow>('SELECT * FROM applications ORDER BY name')
  return rows.map(toApplication)
}

/** IDEA-121's "register a new application" — just a name and a free-text
 * admin contact (name + email, not linked to any contributor row: an
 * application's owner isn't necessarily a fabric-pass user). No key yet —
 * generated separately, same two-step "create, then grant a key" shape
 * every other credential in this app follows. */
export async function createApplication(name: string, contactName: string, contactEmail: string): Promise<Application> {
  const { rows } = await pool.query<ApplicationRow>(
    'INSERT INTO applications (name, contact_name, contact_email) VALUES ($1, $2, $3) RETURNING *',
    [name, contactName, contactEmail],
  )
  return toApplication(rows[0])
}

export interface ApplicationApiKey {
  applicationId: string
  maskedKey: string
  createdAt: Date
}

interface ApplicationApiKeyRow {
  application_id: string
  key_prefix: string
  key_suffix: string
  created_at: Date
}

function toApplicationApiKey(row: ApplicationApiKeyRow): ApplicationApiKey {
  return {
    applicationId: row.application_id,
    maskedKey: `${row.key_prefix}${'•'.repeat(8)}${row.key_suffix}`,
    createdAt: row.created_at,
  }
}

/** IDEA-121 — `null` when this application has never had a key generated. */
export async function getApplicationApiKey(applicationId: string): Promise<ApplicationApiKey | null> {
  const { rows } = await pool.query<ApplicationApiKeyRow>(
    'SELECT application_id, key_prefix, key_suffix, created_at FROM application_api_keys WHERE application_id = $1',
    [applicationId],
  )
  return rows[0] ? toApplicationApiKey(rows[0]) : null
}

export interface GeneratedApplicationApiKey {
  key: string
  apiKey: ApplicationApiKey
}

/** IDEA-121's Generate/Regenerate — identical shape to IDEA-119's
 * `regenerateApiKey`: an upsert against the one row `application_id`
 * (this table's primary key) can ever have. */
export async function regenerateApplicationApiKey(applicationId: string): Promise<GeneratedApplicationApiKey> {
  const key = generateKey()
  const keyHash = hashApiKey(key)
  const keyPrefix = key.slice(0, VISIBLE_PREFIX_LENGTH)
  const keySuffix = key.slice(-VISIBLE_SUFFIX_LENGTH)

  const { rows } = await pool.query<ApplicationApiKeyRow>(
    `INSERT INTO application_api_keys (application_id, key_hash, key_prefix, key_suffix, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (application_id) DO UPDATE
       SET key_hash = EXCLUDED.key_hash, key_prefix = EXCLUDED.key_prefix, key_suffix = EXCLUDED.key_suffix, created_at = now()
     RETURNING application_id, key_prefix, key_suffix, created_at`,
    [applicationId, keyHash, keyPrefix, keySuffix],
  )

  return { key, apiKey: toApplicationApiKey(rows[0]) }
}

/** IDEA-120/121 — resolves a presented application API key to the
 * application it belongs to, by its hash. `null` for an unknown key —
 * same never-throw discipline as api-keys.ts's contributor-key lookup. */
export async function findApplicationByApiKey(presentedKey: string): Promise<string | null> {
  const { rows } = await pool.query<{ application_id: string }>(
    'SELECT application_id FROM application_api_keys WHERE key_hash = $1',
    [hashApiKey(presentedKey)],
  )
  return rows[0]?.application_id ?? null
}
