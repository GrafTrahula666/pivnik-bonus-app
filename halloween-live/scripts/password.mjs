import { passwordHash } from '../src/auth.js';
// Read from stdin; never put the password in a shell command or process arguments.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const password = input.trim();
if (password.length < 16 || password.length > 256) throw new Error('Use a unique password of 16–256 characters.');
console.log(passwordHash(password));
