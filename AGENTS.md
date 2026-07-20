# Agent notes

- Run tests: `node --experimental-test-module-mocks --test <file>`
  (the flag is required - module mocking is experimental)
- Format: `npm run format`
- Tools return errors as strings, never throw.
- All path tools reject paths outside cwd (tools/guard.js).
- Don't edit .env or anything in traces/.