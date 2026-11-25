/** Regenerates src/client/features/editor/emoji-data.json from Linear's native emoji chunk (`Cv.initialize` imports it): each emoji's short name,
 *  character, search keywords and emoticons. `bun scripts/emoji-data.ts [chunk URL]`. The chunk is parsed, never run. */
const url = process.argv[2] ?? "https://static.linear.app/client/assets/emojis.mKI6SeEG.js";
const source = await (await fetch(url)).text();
// The chunk is `var e=[categories],t=`keywords`.split(`.`),n=[emojis],r={…}`: template strings in object literals.
const cook = (raw: string) => JSON.parse(`"${raw.replace(/"/g, '\\"')}"`) as string;
const keywords = cook(/,t=`([^`]*)`\.split\(`\.`\)/.exec(source)![1]!).split(".");
const literal = /,n=(\[\{.*?\}\]),r=\{/s.exec(source)![1]!;
const emojis = JSON.parse(
  literal.replace(/`([^`]*)`/g, (_, raw: string) => JSON.stringify(cook(raw))).replace(/([{,])([a-z]):/g, '$1"$2":'),
) as { n: string; s: string; k: number[]; e?: string[] }[];
const data = {
  source: url,
  keywords,
  emojis: emojis.map((e) => (e.e?.length ? [e.n, e.s, e.k, e.e] : [e.n, e.s, e.k])),
};
await Bun.write("src/client/features/editor/emoji-data.json", JSON.stringify(data));
console.log(`${emojis.length} emoji, ${keywords.length} keywords`);
