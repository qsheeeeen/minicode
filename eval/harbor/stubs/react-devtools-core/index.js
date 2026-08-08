// No-op stub for ink's optional `react-devtools-core` peer dependency.
//
// ink imports this package unconditionally in a devtools module that is only
// loaded when `DEV=true`, but `bun build --compile` resolves it at build time,
// so the standalone eval binary needs a resolvable (and harmless) copy.
const devtools = {
  initialize() {},
  connectToDevTools() {},
};

export default devtools;
