import '../lib/env.js';
import { loadUsers, saveUsers, loadSaved, saveSaved, loadVoice, saveVoice, loadSessions, saveSessions } from '../lib/store.js';
import { createUser, findUserByEmail, hashPassword, accessInfo, normalizeEmail, validEmail } from '../lib/auth.js';

const [cmd, ...args] = process.argv.slice(2);
const DAY = 86_400_000;
const usage = `Owner tools for users (run with: npm run users -- <command>)

  list                              show everyone and their plan
  create <email> <password> [name]  add an account (add --admin to make it an owner)
  grant <email> <days>              give paid access for N days from today (or from the end of current access)
  revoke <email>                    remove paid access
  password <email> <new-password>   reset a password
  admin <email> | unadmin <email>   make / remove an owner
  delete <email>                    delete an account and its saved posts`;

async function need(email) {
  const u = await findUserByEmail(email || '');
  if (!u) { console.error(`No account for "${email}".`); process.exit(1); }
  return u;
}
async function edit(id, fn) { const db = await loadUsers(); fn(db.users[id]); await saveUsers(db); }

if (cmd === 'list') {
  const { users } = await loadUsers();
  const rows = Object.values(users).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!rows.length) console.log('No users yet.');
  for (const u of rows) {
    const a = accessInfo(u);
    console.log(`${u.email.padEnd(32)} ${u.role.padEnd(6)} ${a.plan.padEnd(8)} ${a.daysLeft == null ? '' : `${a.daysLeft} day(s) left`}  paid until: ${u.paidUntil ? u.paidUntil.slice(0, 10) : '-'}  joined ${u.createdAt.slice(0, 10)}`);
  }
} else if (cmd === 'create') {
  const [email, password, name] = args.filter((a) => a !== '--admin');
  if (!validEmail(normalizeEmail(email)) || !password || password.length < 8) { console.error('Need a valid email and a password of at least 8 characters.'); process.exit(1); }
  const { user } = await createUser({ name, email, password, role: args.includes('--admin') ? 'admin' : undefined });
  console.log(`Created ${user.email} (${user.role}).`);
} else if (cmd === 'grant') {
  const u = await need(args[0]); const days = Number(args[1]);
  if (!(days > 0)) { console.error('Give a number of days, e.g. grant a@b.com 30'); process.exit(1); }
  await edit(u.id, (x) => { const from = Math.max(Date.now(), Date.parse(x.paidUntil || 0)); x.paidUntil = new Date(from + days * DAY).toISOString(); });
  console.log(`${u.email} now has paid access until ${(await findUserByEmail(u.email)).paidUntil.slice(0, 10)}.`);
} else if (cmd === 'revoke') {
  const u = await need(args[0]); await edit(u.id, (x) => { x.paidUntil = null; }); console.log(`Paid access removed for ${u.email}.`);
} else if (cmd === 'password') {
  const u = await need(args[0]);
  if (!args[1] || args[1].length < 8) { console.error('Use a new password of at least 8 characters.'); process.exit(1); }
  const hash = await hashPassword(args[1]); await edit(u.id, (x) => { x.passHash = hash; });
  const s = await loadSessions(); for (const [k, v] of Object.entries(s.sessions)) if (v.userId === u.id) delete s.sessions[k]; await saveSessions(s);
  console.log(`Password reset for ${u.email}. They were signed out everywhere.`);
} else if (cmd === 'admin' || cmd === 'unadmin') {
  const u = await need(args[0]); await edit(u.id, (x) => { x.role = cmd === 'admin' ? 'admin' : 'user'; }); console.log(`${u.email} is now ${cmd === 'admin' ? 'an owner' : 'a normal user'}.`);
} else if (cmd === 'delete') {
  const u = await need(args[0]);
  const db = await loadUsers(); delete db.users[u.id]; await saveUsers(db);
  const sv = await loadSaved(); for (const [k, e] of Object.entries(sv.entries)) if (e.userId === u.id) delete sv.entries[k]; await saveSaved(sv);
  const v = await loadVoice(); v.posts = v.posts.filter((x) => x.userId !== u.id); await saveVoice(v);
  const s = await loadSessions(); for (const [k, x] of Object.entries(s.sessions)) if (x.userId === u.id) delete s.sessions[k]; await saveSessions(s);
  console.log(`Deleted ${u.email} and their data.`);
} else console.log(usage);
