// 只攔 f33／f34 對 ./lib/notion.mjs 的匯入，換成純假資料層（不連 Notion、不需要 token）。
export async function resolve(specifier, context, next) {
  if (specifier === "./lib/notion.mjs" && /\/f3[34][^/]*\.mjs$/.test(context.parentURL ?? "")) {
    return { url: new URL("./fake-notion.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
