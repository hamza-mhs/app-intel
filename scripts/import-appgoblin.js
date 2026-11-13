// Import the AppGoblin catalog (CC BY 4.0, https://appgoblin.info) into data/intel.db.
//   npm run import:appgoblin                → downloads the free GitHub files (~120 MB, ~1.1M apps with traction)
//   npm run import:appgoblin -- <file>      → a local .tsv/.tsv.xz (e.g. the full metrics file from appgoblin.info)
// `npm start` also runs the GitHub import automatically on first launch.
import { importAppGoblin } from '../lib/importer.js';

const file = process.argv[2];
await (file ? importAppGoblin({ live: null, metrics: file }) : importAppGoblin());
