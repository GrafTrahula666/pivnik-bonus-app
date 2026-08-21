#!/usr/bin/env python3
from pathlib import Path
import re
import sys

repo = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()

# achievements.js: make the Telegram resolver exactly match the idempotent
# replacement expected by the reviewed Codex patch.
achievements = repo / 'achievements.js'
text = achievements.read_text(encoding='utf-8')
desired = """        AND (
          LOWER(REGEXP_REPLACE(COALESCE(u.username, ''), '^@+', '')) = $1::text
          OR LOWER(REGEXP_REPLACE(COALESCE(ui.provider_username, ''), '^@+', '')) = $1::text
        )
        AND (u.telegram_id IS NOT NULL OR ui.provider_user_id IS NOT NULL)"""
if desired in text:
    print('[skip] preflight Telegram resolver already aligned')
else:
    pattern = re.compile(
        r"\s*AND LOWER\(REGEXP_REPLACE\(COALESCE\(u\.username, ''\), '\^@\+', ''\)\) = \$1::text\n"
        r"\s*AND \(u\.telegram_id IS NOT NULL OR ui\.provider_user_id IS NOT NULL\)"
    )
    text, count = pattern.subn("\n" + desired, text, count=1)
    if count != 1:
        raise RuntimeError('Could not update Telegram achievement username resolver')
    achievements.write_text(text, encoding='utf-8')
    print('[ok] preflight Telegram resolver aligned exactly')

# server.js: current main contains a harmless blank line after achievement sync,
# while the Codex patch expects these statements adjacent. Install the final
# referral hook directly so the main patch treats it as already applied.
server = repo / 'server.js'
server_text = server.read_text(encoding='utf-8')
completed_desired = """    await client.query('COMMIT');
    await syncUserAchievements(pool, targetUser.id);
    await reconcileReferral(pool, targetUser.id).catch((error) => {
      console.error('Referral reconciliation after purchase failed:', error?.code || error?.message || 'unknown');
    });
    const tx = txResult.rows[0];"""
if completed_desired in server_text:
    print('[skip] preflight completed purchase hook already aligned')
else:
    completed_pattern = re.compile(
        r"    await client\.query\('COMMIT'\);\n"
        r"    await syncUserAchievements\(pool, targetUser\.id\);\n\s*"
        r"    const tx = txResult\.rows\[0\];"
    )
    server_text, count = completed_pattern.subn(completed_desired, server_text, count=1)
    if count != 1:
        raise RuntimeError('Could not align completed purchase referral hook')
    server.write_text(server_text, encoding='utf-8')
    print('[ok] preflight completed purchase referral hook aligned exactly')
