import {useRef,useState} from "react";
import {MenuSurface} from "./menu-surface";
import {get} from "./store";

const groups:Record<string,string>= {
  Popular:"👍:thumbs up yes approve|👎:thumbs down no|🎉:party popper celebration|❤️:red heart love|👀:eyes looking watching|🚀:rocket launch|✅:check done complete|🙏:folded hands thanks please|💯:hundred perfect|🔥:fire hot|👏:clap applause|💪:flexed biceps strong",
  Faces:"😀:grinning smile happy|😄:smile laugh|😂:tears of joy lol|🥹:holding back tears|😊:blush happy|😍:heart eyes|🤔:thinking question|🫡:salute understood|🙃:upside down|😅:sweat smile|😎:cool sunglasses|🥳:party face|😢:cry sad|😭:sob crying|😬:grimace|😴:sleep tired|🤯:mind blown|🤝:handshake agreement",
  Gestures:"👋:wave hello|👌:ok hand|✌️:victory peace|🤞:crossed fingers luck|🤘:rock on|🙌:raised hands hooray|👐:open hands|✍️:writing hand|🧑‍💻:technologist coding|🧑‍🔧:mechanic fixing",
  Objects:"💡:light bulb idea|⚡:lightning fast|🐛:bug|🛠️:tools fix|🔧:wrench|🧪:test experiment|🧹:broom cleanup|📌:pin|🎯:target goal|📦:package shipping|🔒:lock secure|🔍:search inspect|⏳:hourglass waiting|🚧:construction work|🏁:finish flag|🏆:trophy win|🌱:seedling growth|🌈:rainbow|☕:coffee|🍕:pizza|🐱:cat|🐶:dog|🦆:duck|🦄:unicorn|🦋:butterfly|🌟:star|💚:green heart|💙:blue heart|💜:purple heart|🧡:orange heart|🤍:white heart|🖤:black heart"
};
const options=Object.entries(groups).flatMap(([group,items])=>items.split("|").map(item=>{const [emoji,name]=item.split(":");return {emoji:emoji!,name:name!,group};}));
const tones=["","🏻","🏼","🏽","🏾","🏿"];
const toneable=new Set(["👍","👎","🙏","👏","💪","👋","👌","✌️","🤞","🤘","🙌","👐","✍️","🧑‍💻","🧑‍🔧"]);
export function isSingleEmoji(value:string):boolean {
  return [...new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(value)].length===1&&/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value);
}
function withTone(emoji:string,tone:string){if(!tone||!toneable.has(emoji))return emoji;const points=[...emoji.replaceAll("\ufe0f","")];return points[0]+tone+points.slice(1).join("");}
export function ReactionPicker({anchor,close,choose}:{anchor:HTMLElement|null;close:()=>void;choose:(emoji:string)=>void}) {
  const storageKey=`better-jira:reactions:${get().namespace}`;
  const [query,setQuery]=useState(""),[tone,setTone]=useState("");
  const [recent]=useState<string[]>(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)??"[]");return Array.isArray(value)?value.filter(v=>typeof v==="string"&&isSingleEmoji(v)).slice(0,18):[];}catch{return [];}});
  const grid=useRef<HTMLDivElement>(null);
  const select=(emoji:string)=>{try{localStorage.setItem(storageKey,JSON.stringify([emoji,...recent.filter(r=>r!==emoji)].slice(0,18)));}catch{}choose(emoji);close();};
  const matching=options.filter(option=>`${option.name} ${option.group} ${option.emoji}`.toLowerCase().includes(query.toLowerCase()));
  return <MenuSurface label="Choose reaction" anchor={anchor} width={340} close={close}>
    <input aria-label="Search emoji" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{const q=query.trim(),first=matching[0],pick=isSingleEmoji(q)?q:q&&first?withTone(first.emoji,tone):"";if(e.key==="Enter"&&pick){e.preventDefault();select(pick);}}} placeholder="Search emoji or paste one…" className="mb-2 w-full rounded-md border border-line-2 bg-card px-3 py-2 outline-none focus:border-accent"/>
    <div role="group" aria-label="Skin tone" className="mb-2 flex gap-1">{tones.map((t,i)=><button key={i} aria-label={i?`Skin tone ${i}`:"Default skin tone"} aria-pressed={tone===t} onClick={()=>setTone(t)} className={`rounded p-1 ${tone===t?"bg-sel":"hover:bg-hover"}`}>{withTone("👍",t)}</button>)}</div>
    <div ref={grid} className="max-h-[300px] overflow-y-auto" onKeyDown={e=>{
      const buttons=[...grid.current!.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const offset={ArrowRight:1,ArrowLeft:-1,ArrowDown:8,ArrowUp:-8}[e.key];
      if(offset!==undefined&&index>=0){e.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,index+offset))]?.focus();}
    }}>
      {isSingleEmoji(query.trim())&&<button aria-label={`React ${query.trim()}`} onClick={()=>select(query.trim())} className="mb-2 w-full rounded-md bg-sel px-3 py-2 text-left">Use {query.trim()}</button>}
      {!query&&recent.length>0&&<><p className="mb-1 text-[11px] text-fg-3">Recent</p><div className="mb-2 grid grid-cols-8">{recent.map(emoji=><button key={emoji} aria-label={`React ${emoji}`} onClick={()=>select(emoji)} className="rounded-md p-1.5 text-xl hover:bg-hover">{emoji}</button>)}</div></>}
      {Object.keys(groups).map(group=>{const items=matching.filter(option=>option.group===group);return !!items.length&&<div key={group}><p className="my-1 text-[11px] text-fg-3">{group}</p><div className="grid grid-cols-8">{items.map(({emoji,name})=><button key={emoji} aria-label={`React ${withTone(emoji,tone)} ${name}`} title={name} onClick={()=>select(withTone(emoji,tone))} className="rounded-md p-1.5 text-xl hover:bg-hover">{withTone(emoji,tone)}</button>)}</div></div>;})}
      {!matching.length&&!isSingleEmoji(query.trim())&&<p className="py-3 text-fg-3">No matches. Paste any single emoji to use it.</p>}
    </div>
  </MenuSurface>;
}
