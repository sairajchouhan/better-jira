import {useEffect,useRef,useState} from "react";
import {MenuSurface} from "./menu-surface";
import {get} from "./store";

// Linear's picker (RAJ-52): "Frequently used" first, then categories. ponytail: a curated set, not the full Unicode catalogue; add a dataset if search misses matter.
const groups:Record<string,string>= {
  "Smileys & People":"👍:thumbs up yes approve|👎:thumbs down no|🙏:folded hands thanks please|👏:clap applause|💪:flexed biceps strong|😀:grinning smile happy|😄:smile laugh|😂:tears of joy lol|🥹:holding back tears|😊:blush happy|😍:heart eyes|🤔:thinking question|🫡:salute understood|🙃:upside down|😅:sweat smile|😎:cool sunglasses|🥳:party face|😢:cry sad|😭:sob crying|😬:grimace|😴:sleep tired|🤯:mind blown|🤝:handshake agreement|👋:wave hello|👌:ok hand|✌️:victory peace|🤞:crossed fingers luck|🤘:rock on|🙌:raised hands hooray|👐:open hands|✍️:writing hand|🧑‍💻:technologist coding|🧑‍🔧:mechanic fixing|😃:smiley happy|🙂:slightly smiling face|😕:confused",
  Objects:"🎉:party popper celebration|❤️:red heart love|👀:eyes looking watching|🚀:rocket launch|✅:check done complete|💯:hundred perfect|🔥:fire hot|💡:light bulb idea|⚡:lightning fast|🐛:bug|🛠️:tools fix|🔧:wrench|🧪:test experiment|🧹:broom cleanup|📌:pin|🎯:target goal|📦:package shipping|🔒:lock secure|🔍:search inspect|⏳:hourglass waiting|🚧:construction work|🏁:finish flag|🏆:trophy win|🌱:seedling growth|🌈:rainbow|☕:coffee|🍕:pizza|🐱:cat|🐶:dog|🦆:duck|🦄:unicorn|🦋:butterfly|🌟:star|💚:green heart|💙:blue heart|💜:purple heart|🧡:orange heart|🤍:white heart|🖤:black heart|⚠️:warning|❌:x cross no",
};
export const emojiOptions=Object.entries(groups).flatMap(([group,items])=>items.split("|").map(item=>{const [emoji,name]=item.split(":");return {emoji:emoji!,name:name!,group};}));
/** Linear's default "Frequently used" rows, which recent picks push along. */
const FREQUENT=["👍","👌","🙏","😂","❤️","👀","✅","🙂","😃","😄","😀","🤔","😅","⚠️","😕","❌","🙌","💙"];
const SHORTCODES:Record<string,string>={"👍":"+1","👎":"-1","👌":"ok_hand","🙏":"pray","😂":"joy","❤️":"heart","👀":"eyes","✅":"white_check_mark","🙂":"slightly_smiling_face","😃":"smiley","😄":"smile","😀":"grinning","🤔":"thinking_face","😅":"sweat_smile","⚠️":"warning","😕":"confused","❌":"x","🙌":"raised_hands","💙":"blue_heart","🎉":"tada","🚀":"rocket","🔥":"fire","💯":"100","👏":"clap","💪":"muscle"};
/** The emoji's shortcode, as Linear's tooltip names it ("You reacted with :+1:"). ponytail: names outside SHORTCODES use their first words. */
export const shortcode=(emoji:string)=>SHORTCODES[emoji]??emojiOptions.find(option=>option.emoji===emoji)?.name.split(" ").slice(0,2).join("_")??emoji;
export function isSingleEmoji(value:string):boolean {
  return [...new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(value)].length===1&&/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value);
}
/** Linear tints the active cell with the emoji's own colour at 0.175 alpha. */
const tints=new Map<string,string>();
function tint(emoji:string){
  if(!tints.has(emoji)){
    const canvas=document.createElement("canvas");canvas.width=canvas.height=20;const ctx=canvas.getContext("2d",{willReadFrequently:true});let r=0,g=0,b=0,n=0;
    if(ctx){ctx.font="16px sans-serif";ctx.textBaseline="top";ctx.fillText(emoji,1,1);const data=ctx.getImageData(0,0,20,20).data;for(let i=0;i<data.length;i+=4)if(data[i+3]!>128){r+=data[i]!;g+=data[i+1]!;b+=data[i+2]!;n++;}}
    tints.set(emoji,n?`rgb(${Math.round(r/n)} ${Math.round(g/n)} ${Math.round(b/n)} / 0.175)`:"var(--menu-sel)");
  }
  return tints.get(emoji)!;
}
/** Linear's reaction picker (RAJ-52): 274px, right-aligned 3.6px under its button, a padded search field that keeps focus while the arrows move through 9 columns of 28px cells. */
export function ReactionPicker({anchor,close,choose}:{anchor:HTMLElement|null;close:()=>void;choose:(emoji:string)=>void}) {
  const storageKey=`better-jira:reactions:${get().namespace}`;
  const [query,setQuery]=useState(""),[active,setActive]=useState(-1);
  const [recent]=useState<string[]>(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)??"[]");return Array.isArray(value)?value.filter(v=>typeof v==="string"&&isSingleEmoji(v)).slice(0,18):[];}catch{return [];}});
  const select=(emoji:string)=>{try{localStorage.setItem(storageKey,JSON.stringify([emoji,...recent.filter(r=>r!==emoji)].slice(0,18)));}catch{}choose(emoji);close();};
  const q=query.trim().toLowerCase();
  const sections:[string,string[]][]=q?[["Search results",[...isSingleEmoji(query.trim())?[query.trim()]:[],...emojiOptions.filter(option=>`${option.name} ${shortcode(option.emoji)} ${option.emoji}`.toLowerCase().includes(q)).map(option=>option.emoji)]]]
    :[["Frequently used",[...new Set([...recent,...FREQUENT])].slice(0,18)],...Object.keys(groups).map(group=>[group,emojiOptions.filter(option=>option.group===group).map(option=>option.emoji)] as [string,string[]])];
  const flat=sections.flatMap(([,items])=>items);
  const cell=useRef<(HTMLButtonElement|null)[]>([]);
  useEffect(()=>{cell.current[active]?.scrollIntoView({block:"nearest"});},[active]);
  let index=-1;
  return <MenuSurface label="Choose reaction" anchor={anchor} close={close} fit gap={3.6} align="end">
    <div className="w-[272px]">
      <div className="border-b border-[var(--key-line)] px-[5px] py-1"><input autoFocus aria-label="Search emoji" placeholder="Search emoji…" value={query} onChange={e=>{setQuery(e.target.value);setActive(-1);}} onKeyDown={e=>{
        const step={ArrowRight:1,ArrowLeft:-1,ArrowDown:9,ArrowUp:-9}[e.key];
        if(step!==undefined&&flat.length){e.preventDefault();setActive(active<0?0:Math.max(0,Math.min(flat.length-1,active+step)));}
        if(e.key==="Enter"){const pick=flat[active<0?0:active];if(pick){e.preventDefault();select(pick);}}
      }} className="h-7 w-full rounded-lg bg-[var(--menu)] py-1.5 pr-7 pl-[9px] text-[13px] text-[var(--menu-fg)] outline-none placeholder:text-fg-3"/></div>
      <div className="max-h-[283px] overflow-y-auto px-2.5 pb-2">
        {sections.map(([heading,items])=>items.length>0&&<div key={heading}>
          <div className="flex h-7 items-center pr-1.5 pl-1 text-[12px] font-medium text-fg-3">{heading}</div>
          <div className="grid grid-cols-[repeat(9,28px)]">{items.map(emoji=>{const i=++index;return <button key={`${heading}${emoji}`} ref={node=>{cell.current[i]=node;}} tabIndex={-1} aria-label={`React ${emoji} ${shortcode(emoji)}`} data-active={i===active||undefined} onMouseEnter={()=>setActive(i)} onClick={()=>select(emoji)} style={i===active?{background:tint(emoji)}:undefined} className="grid size-7 place-items-center rounded-lg text-[20px] leading-none">{emoji}</button>;})}</div>
        </div>)}
        {!flat.length&&<p className="px-1 py-2 text-[13px] text-fg-3">No emoji found</p>}
      </div>
    </div>
  </MenuSurface>;
}
