// 只攔 f24*.mjs 對 ./lib/notion.mjs 的匯入；其他模組（含模擬層自己引用的真 lib）照常解析。
export async function resolve(specifier, context, next) {
  if (specifier === "./lib/notion.mjs" && /\/f24[^/]*\.mjs$/.test(context.parentURL ?? "")) {
    return { url: new URL("./notion-sim.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
