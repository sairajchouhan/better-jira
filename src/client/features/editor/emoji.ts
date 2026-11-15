import { compareText } from "@/shared/compare";
import { InputRule, inputRules } from "prosemirror-inputrules";
import { caretTrigger, type CaretTrigger } from "./caret-trigger";
import { deprioritize, fuzzyScore, prioritize } from "@/client/lib/fuzzy-score";
import { emojiNode } from "./rich-document";
import type { EditorState, Transaction } from "prosemirror-state";

export type Emoji = { name: string; char: string; keywords: string[]; emoticons: string[] };
type EmojiData = { keywords: string[]; emojis: [string, string, number[], string[]?][] };

/** Linear's native emoji set (`Cv.getNativeEmojis`), shipped as its own chunk and fetched once an editor first needs it. */
let emojis: Emoji[] = [];
let byName = new Map<string, Emoji>(),
  bySymbol = new Map<string, Emoji>();
let loading: Promise<Emoji[]> | undefined;
export const loadEmoji = () =>
  (loading ??= import("./emoji-data.json").then(({ default: json }) => {
    const data = json as unknown as EmojiData;
    emojis = data.emojis.map(([name, char, k, emoticons = []]) => ({
      name,
      char,
      keywords: k.map((i) => data.keywords[i]!),
      emoticons,
    }));
    byName = new Map(emojis.map((e) => [e.name, e]));
    bySymbol = new Map(emojis.map((e) => [e.char, e]));
    return emojis;
  }));

// Linear's search (`Cv.score`, `Cv.getCandidates`): common emoji rank first, then a name, emoticon or keyword match.
const COMMON = ["+1", "ok_hand", "pray", "joy", "heart", "eyes", "white_check_mark", "slightly_smiling_face", "smiley", "smile", "grinning", "thinking_face", "sweat_smile", "warning", "eyes", "confused", "x", "raised_hands", "tada", "wink", "blush", "shrug", "wave", "question"];
const SHORTCUTS = new Map([[":)", "slightly_smiling_face"], [":(", "disappointed"]]);
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[&+]/g, "and")
    .replace(/[\s-]/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¡-¿]/g, "")
    .trim();
/** Each word of a name, keyword or emoticon, and the term joined up ("thumbs_up" → thumbs, up, thumbsup). */
function tokens(term: string) {
  const out: string[] = [];
  let word = "",
    joined = "";
  for (const char of normalize(term)) {
    const code = char.charCodeAt(0);
    if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code >= 128) {
      word += char;
      joined += char;
    } else if (word) {
      out.push(word);
      word = "";
    }
  }
  if (word) out.push(word);
  if (joined && !out.includes(joined)) out.push(joined);
  return out;
}
const searchText = new WeakMap<Emoji, { prefixes: Set<string>; text: string }>();
function indexOf(emoji: Emoji) {
  let entry = searchText.get(emoji);
  if (!entry) {
    const words = [...new Set([emoji.name, ...emoji.keywords, ...emoji.emoticons].flatMap(tokens))];
    entry = { prefixes: new Set(words.flatMap((w) => [w.charAt(0), w.slice(0, 2)])), text: words.join(" ") };
    searchText.set(emoji, entry);
  }
  return entry;
}
function candidates(query: string): Emoji[] {
  const shortcut = SHORTCUTS.get(`:${query}`);
  if (shortcut) return byName.has(shortcut) ? [byName.get(shortcut)!] : [];
  const [first, ...rest] = normalize(query).split(" ").filter(Boolean);
  if (!first) return [];
  const prefix = first.slice(0, 2);
  return emojis.filter((emoji) => {
    const { prefixes, text } = indexOf(emoji);
    return (prefixes.has(prefix) || (first.length > 3 && text.includes(first))) && rest.every((w) => text.includes(w));
  });
}
function score(emoji: Emoji, query: string) {
  const emoticon = query.length <= 3 ? fuzzyScore(emoji.emoticons, `:${query}`) : 0;
  const best = Math.max(
    fuzzyScore(emoji.name, query),
    prioritize(emoticon, 1000),
    deprioritize(fuzzyScore(emoji.keywords, query), 2),
  );
  if (emoji.name === query) return prioritize(best, 1000);
  const common = COMMON.indexOf(emoji.name);
  return common > -1 ? prioritize(best, 50 + COMMON.length - common) : best;
}

/** The emoji menu's results for `query`, best first: Linear keeps a short query's matches above 0.15 and shows 12 (`cQ`). */
export function matchingEmoji(query: string, limit = 12): Emoji[] {
  return candidates(query)
    .map((emoji) => ({ emoji, score: score(emoji, query) }))
    .filter((e) => (query.length < 5 ? e.score > 0.15 : e.score > 0))
    .sort((a, b) => b.score - a.score || compareText(a.emoji.name, b.emoji.name))
    .slice(0, limit)
    .map((e) => e.emoji);
}

// ":" at a word start (or after "("), then one or more of a short name's characters; a space cancels it ("12:30" and "Note: x" open nothing).
const trigger = caretTrigger("emoji", /(?:^|[\s(]):([\w+-]{1,30})$/);
export const activeEmoji = trigger.active;
export const dismissEmoji = trigger.dismiss;
export const emojiPlugin = (keys: Parameters<typeof trigger.plugin>[0]) => {
  void loadEmoji();
  return trigger.plugin(keys);
};
export const insertEmoji = (state: EditorState, at: CaretTrigger, emoji: Emoji): Transaction =>
  state.tr.replaceWith(at.from, at.to, emojiNode(emoji));

// Linear's emoticons (`AMe`), each typed then a space; on by default in Linear's settings ("Convert text emoticons into emojis").
const EMOTICONS: Record<string, string> = { "<3": "❤️", "</3": "💔", ":)": "🙂", ":-)": "🙂", "=)": "🙂", "=-)": "🙂", "(:": "🙂", ":(": "🙁", ":-(": "🙁", ":D": "😀", ":-D": "😀", "=D": "😀", "=-D": "😀", ":P": "😛", ":-P": "😛", ":p": "😛", ":-p": "😛", "=P": "😛", "=-P": "😛", "=p": "😛", "=-p": "😛", ":b": "😛", ":-b": "😛", ";)": "😉", ";-)": "😉", ";P": "😜", ";-P": "😜", ";p": "😜", ";-p": "😜", ";b": "😜", ";-b": "😜", ":/": "😕", ":-/": "😕", ":\\": "😕", ":-\\": "😕", ":|": "😐", ":-|": "😐", "-_-": "😑", "8)": "😎", "8-)": "😎", "B)": "😎", "B-)": "😎", ":O": "😮", ":-O": "😮", ":o": "😮", ":-o": "😮", ":0": "😮", ":-0": "😮", ":*": "😗", ":-*": "😗", ":3": "😺", ":-3": "😺", ":>": "😆", "D:": "😧", ";(": "😢", ";-(": "😢", ":'(": "😢", ":'-(": "😢", "):": "😞", ">:(": "😠", ">:-(": "😠", ":')": "😂", ":'-)": "😂", ":o)": "🐵", "^_^": "😊", "^.^": "😊", T_T: "😭", "T.T": "😭", ";_;": "😭", ";-;": "😭", ">_<": "😣", o_O: "🤨", O_o: "🤨", O_O: "😳", o_o: "😳" };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const emoticonPattern = new RegExp(
  `(?:^|\\s)(${Object.keys(EMOTICONS).sort((a, b) => b.length - a.length).map(escape).join("|")}) $`,
);

/** A whole known `:name:` typed out becomes its emoji, and so does an emoticon followed by a space, like Linear. Never in code. */
export const emojiRules = inputRules({
  rules: [
    new InputRule(
      /(?:^|[\s(]):([\w+-]+):$/,
      (state, match, _start, end) => {
        const emoji = byName.get(match[1]!);
        // The rule fires before the final ":" is inserted, so the name and its first ":" are what is replaced.
        return emoji ? state.tr.replaceWith(end - match[1]!.length - 1, end, emojiNode(emoji)) : null;
      },
      { inCodeMark: false },
    ),
    new InputRule(
      emoticonPattern,
      (state, match, _start, end) => {
        const emoji = bySymbol.get(EMOTICONS[match[1]!]!);
        if (!emoji) return null;
        // The space is typed, not yet in the document: the emoticon is replaced and the space follows the emoji.
        return state.tr.replaceWith(end - match[1]!.length, end, [emojiNode(emoji), state.schema.text(" ")]);
      },
      { inCodeMark: false },
    ),
  ],
});
