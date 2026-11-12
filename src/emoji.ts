import { InputRule, inputRules } from "prosemirror-inputrules";
import { caretTrigger, type CaretTrigger } from "./caret-trigger";
import { emojiNode } from "./rich-document";
import type { EditorState, Transaction } from "prosemirror-state";

export type Emoji = { name: string; char: string };
// ponytail: a hand-picked set of common emoji, not Unicode's full list; swap in a full dataset if people miss names.
const LIST =
  "smile 😄,smiley 😃,grinning 😀,grin 😁,laughing 😆,sweat_smile 😅,joy 😂,rofl 🤣,slightly_smiling_face 🙂,upside_down_face 🙃,wink 😉,blush 😊,innocent 😇,heart_eyes 😍,star_struck 🤩,kissing_heart 😘,yum 😋,stuck_out_tongue 😛,thinking 🤔,hugs 🤗,shushing_face 🤫,neutral_face 😐,expressionless 😑,no_mouth 😶,smirk 😏,unamused 😒,roll_eyes 🙄,grimacing 😬,relieved 😌,pensive 😔,sleepy 😪,sleeping 😴,mask 😷,nauseated_face 🤢,sneezing_face 🤧,hot_face 🥵,cold_face 🥶,dizzy_face 😵,exploding_head 🤯,cowboy_hat_face 🤠,partying_face 🥳,sunglasses 😎,nerd_face 🤓,confused 😕,worried 😟,slightly_frowning_face 🙁,open_mouth 😮,astonished 😲,flushed 😳,pleading_face 🥺,fearful 😨,cold_sweat 😰,cry 😢,sob 😭,scream 😱,confounded 😖,disappointed 😞,sweat 😓,weary 😩,tired_face 😫,yawning_face 🥱,triumph 😤,rage 😡,angry 😠,skull 💀,poop 💩,clown_face 🤡,ghost 👻,alien 👽,robot 🤖,see_no_evil 🙈,hear_no_evil 🙉,speak_no_evil 🙊,wave 👋,raised_hand ✋,ok_hand 👌,pinched_fingers 🤌,v ✌️,crossed_fingers 🤞,metal 🤘,call_me_hand 🤙,point_left 👈,point_right 👉,point_up 👆,point_down 👇,thumbsup 👍,+1 👍,thumbsdown 👎,-1 👎,fist 👊,clap 👏,raised_hands 🙌,open_hands 👐,handshake 🤝,pray 🙏,writing_hand ✍️,muscle 💪,eyes 👀,brain 🧠,heart ❤️,orange_heart 🧡,yellow_heart 💛,green_heart 💚,blue_heart 💙,purple_heart 💜,black_heart 🖤,broken_heart 💔,sparkling_heart 💖,100 💯,boom 💥,sparkles ✨,star ⭐,star2 🌟,zap ⚡,fire 🔥,rainbow 🌈,sunny ☀️,cloud ☁️,snowflake ❄️,umbrella ☔,coffee ☕,tea 🍵,beer 🍺,beers 🍻,wine_glass 🍷,pizza 🍕,hamburger 🍔,cake 🍰,birthday 🎂,cookie 🍪,apple 🍎,tada 🎉,confetti_ball 🎊,balloon 🎈,gift 🎁,trophy 🏆,medal 🏅,dart 🎯,video_game 🎮,art 🎨,musical_note 🎵,bell 🔔,mega 📣,loudspeaker 📢,bulb 💡,mag 🔍,lock 🔒,unlock 🔓,key 🔑,hammer 🔨,wrench 🔧,gear ⚙️,link 🔗,paperclip 📎,pushpin 📌,memo 📝,pencil2 ✏️,book 📖,books 📚,calendar 📅,date 📆,clipboard 📋,chart_with_upwards_trend 📈,chart_with_downwards_trend 📉,bar_chart 📊,email 📧,inbox_tray 📥,outbox_tray 📤,package 📦,computer 💻,keyboard ⌨️,desktop_computer 🖥️,iphone 📱,phone ☎️,hourglass ⌛,alarm_clock ⏰,stopwatch ⏱️,rocket 🚀,airplane ✈️,car 🚗,ship 🚢,construction 🚧,rotating_light 🚨,warning ⚠️,no_entry ⛔,x ❌,heavy_check_mark ✔️,white_check_mark ✅,ballot_box_with_check ☑️,question ❓,exclamation ❗,bangbang ‼️,heavy_plus_sign ➕,heavy_minus_sign ➖,arrow_right ➡️,arrow_left ⬅️,arrow_up ⬆️,arrow_down ⬇️,recycle ♻️,red_circle 🔴,large_blue_circle 🔵,green_circle 🟢,yellow_circle 🟡,white_circle ⚪,black_circle ⚫,bug 🐛,ant 🐜,bee 🐝,snail 🐌,turtle 🐢,snake 🐍,dog 🐶,cat 🐱,unicorn 🦄,monkey 🐒,bird 🐦,penguin 🐧,fish 🐟,whale 🐳,octopus 🐙,seedling 🌱,evergreen_tree 🌲,palm_tree 🌴,cactus 🌵,four_leaf_clover 🍀,rose 🌹,sunflower 🌻,earth_americas 🌎,moon 🌙,money_with_wings 💸,moneybag 💰,dollar 💵,gem 💎,crown 👑,ring 💍,wave_dash 〰️,shrug 🤷,facepalm 🤦,man_technologist 👨‍💻,woman_technologist 👩‍💻,ninja 🥷,zombie 🧟,santa 🎅,ok 🆗,new 🆕,free 🆓,cool 🆒,sos 🆘,soon 🔜,top 🔝";
export const EMOJI: Emoji[] = LIST.split(",").map((entry) => {
  const at = entry.indexOf(" ");
  return { name: entry.slice(0, at), char: entry.slice(at + 1) };
});

/** Emoji whose short name has a word starting with the query: an exact name first, then names starting with it. */
export function matchingEmoji(query: string, limit = 20): Emoji[] {
  const q = query.toLowerCase();
  const starts = EMOJI.filter((e) => e.name.startsWith(q)).sort((a, b) => +(b.name === q) - +(a.name === q)),
    words = EMOJI.filter((e) => !e.name.startsWith(q) && e.name.split("_").some((w) => w.startsWith(q)));
  return [...starts, ...words].slice(0, limit);
}

// ":" at a word start, then two or more of a short name's characters ("12:30" and "Note: x" open nothing).
const trigger = caretTrigger("emoji", /(?:^|[\s(]):([\w+-]{2,30})$/);
export const activeEmoji = trigger.active;
export const dismissEmoji = trigger.dismiss;
export const emojiPlugin = trigger.plugin;
export const insertEmoji = (state: EditorState, at: CaretTrigger, emoji: Emoji): Transaction =>
  state.tr.replaceWith(at.from, at.to, emojiNode(emoji));

/** A whole known `:name:` typed out becomes its emoji, like Linear. */
export const emojiRules = inputRules({
  rules: [
    new InputRule(
      /(?:^|[\s(]):([\w+-]+):$/,
      (state, match, _start, end) => {
        const emoji = EMOJI.find((e) => e.name === match[1]);
        // The rule fires before the final ":" is inserted, so the name and its first ":" are what is replaced.
        return emoji ? state.tr.replaceWith(end - match[1]!.length - 1, end, emojiNode(emoji)) : null;
      },
      { inCodeMark: false },
    ),
  ],
});
