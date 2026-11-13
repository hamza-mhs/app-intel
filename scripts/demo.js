// Cross-platform demo launcher (Windows shells can't do `MOCK=1 node ...`).
process.env.MOCK = '1';
process.env.DATA_DIR ||= 'data-demo';
process.env.APP_INTEL_MAIN = '1';
await import('../server.js');
