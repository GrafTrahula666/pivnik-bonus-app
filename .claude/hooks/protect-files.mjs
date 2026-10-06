// PreToolUse: block edits to .env files and already-applied migrations.
const input = JSON.parse(await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => d += c); process.stdin.on('end', () => r(d || '{}')); }));
const file = (input.tool_input?.file_path || '').replaceAll('\\', '/');
if (/(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(file)) {
  console.error('Blocked: .env files must not be edited by the agent.'); process.exit(2);
}
if (/(^|\/)migrations\/\d{3}_[^/]+\.sql$/.test(file) && input.tool_name === 'Edit') {
  console.error('Blocked: applied migrations are immutable. Add a new migration instead.'); process.exit(2);
}
