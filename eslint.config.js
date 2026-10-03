// The rules themselves live in tools/lint/rules.js. They are imported from
// there rather than written here so that the TypeScript parser they need
// resolves against that directory's TypeScript 6 instead of the
// TypeScript 7 that typechecks the repo. tools/lint/package.json says why.
//
// Run the linter with `npm run lint`, never with a bare `npx eslint`:
// ESLint is not a root dependency, and the wrapper installs tools/lint on
// first use.
export { default } from "./tools/lint/rules.js";
