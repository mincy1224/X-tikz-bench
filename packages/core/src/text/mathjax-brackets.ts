import type * as TokenMapModule from "@mathjax/src/js/input/tex/TokenMap.js";
import type * as ParseMethodsModule from "@mathjax/src/js/input/tex/ParseMethods.js";
import type * as ConfigurationModule from "@mathjax/src/js/input/tex/Configuration.js";
type BracketModules = {
  TokenMap: Pick<typeof TokenMapModule, "DelimiterMap">;
  ParseMethods: Pick<typeof ParseMethodsModule, "default">;
  Configuration: Pick<typeof ConfigurationModule, "Configuration">;
};
const registered = new WeakSet<object>();
export function registerMathJaxBrackets(modules: BracketModules): void {
  if (registered.has(modules.TokenMap)) return;
  const parse = ((parser, token) => { modules.ParseMethods.default.delimiter(parser, token as Parameters<BracketModules["ParseMethods"]["default"]["delimiter"]>[1]); }) as ConstructorParameters<BracketModules["TokenMap"]["DelimiterMap"]>[1];
  new modules.TokenMap.DelimiterMap("tikz-bracket-delimiters", parse, { "\\llbracket": "\u27E6", "\\rrbracket": "\u27E7" });
  modules.Configuration.Configuration.create("tikz-brackets", { handler: { delimiter: ["tikz-bracket-delimiters"], macro: ["tikz-bracket-delimiters"] } });
  registered.add(modules.TokenMap);
}
export function registerGlobalMathJaxBrackets(): void {
  const root = globalThis as unknown as { MathJax?: { _: { input: { tex: BracketModules } } } };
  if (root.MathJax?._?.input?.tex) registerMathJaxBrackets(root.MathJax._.input.tex);
}
