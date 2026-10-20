// Ambient declaration for side-effect CSS imports (e.g. `import "./globals.css"`).
// Next.js types only declare `*.module.css`; TS reports ts(2882) for plain CSS
// imports when side-effect imports are checked (noUncheckedSideEffectImports).
// `*.module.css` stays unmatched here because the more specific `*.module.css`
// pattern from Next wins.
declare module "*.css";