#!/usr/bin/env python3
from pathlib import Path
import re
import sys

repo = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
path = repo / 'achievements.js'
text = path.read_text(encoding='utf-8')

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
    path.write_text(text, encoding='utf-8')
    print('[ok] preflight Telegram resolver aligned exactly')
