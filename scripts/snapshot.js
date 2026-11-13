// Record today's metrics for every tracked app. Run daily from cron, e.g.:
//   15 3 * * *  cd /path/to/app-intel && node scripts/snapshot.js >> data/snapshot.log 2>&1
import { snapshotAll } from '../server.js';

await snapshotAll();
