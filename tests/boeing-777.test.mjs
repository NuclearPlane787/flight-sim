// The Boeing law's and autoflight's tests, on the 777-300ER too (they default to the 787-9): V030.md's
// "for each new type". One process per test file, so setting the type here reaches only these.
process.env.BOEING_TYPE = 'b777-300er';
await import('./boeing-law.test.mjs');
await import('./boeing-ap.test.mjs');
