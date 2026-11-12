// v0.4.2: the auto-trim tests (boeing-autotrim.test.mjs, the 777-300ER's by default) on the 787-9 too.
// One process per test file, so setting the type here reaches only these.
process.env.BOEING_TYPE = 'b787-9';
await import('./boeing-autotrim.test.mjs');
