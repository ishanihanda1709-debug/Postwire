import '../lib/env.js';
import { refreshAll } from '../lib/refresh.js';
const r = await refreshAll();
console.log('Refresh complete:', r);
