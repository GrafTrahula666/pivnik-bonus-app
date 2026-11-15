// Read-only attestation for an operator inside the Railway staging Admin service.
// Output is a fixed whitelist of booleans and nulls. No DB query or secret output.
import { summarizeStagingDatabaseIsolation } from './staging-database-isolation.mjs'
process.stdout.write(JSON.stringify(summarizeStagingDatabaseIsolation(),null,2)+'\n')
