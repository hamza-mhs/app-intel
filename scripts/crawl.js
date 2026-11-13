// Run the category crawl once (also runs daily inside `npm start`). Cron example:
//   30 2 * * *  cd /path/to/app-intel && CRAWL_COUNTRIES=us,gb node scripts/crawl.js >> data/crawl.log 2>&1
import { crawl } from '../lib/crawler.js';

await crawl();
