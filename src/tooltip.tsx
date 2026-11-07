import {useEffect,useLayoutEffect,useRef,useState} from "react";

/** Linear's tooltip for every `title`: after a short hover a menu-surface label sits 8px under the control (above for `data-tip="above"`, like Linear's timestamps, or when there is no room),
 *  with a trailing "(keys)" shown as key caps. The native title is parked in data-title while it shows, so the browser's own tip never doubles it. */
export function Tooltips(){
  const [tip,setTip]=useState<{text:string;keys:string[];x:number;y:number;above:boolean}|null>(null),ref=useRef<HTMLDivElement>(null);
  // Centred under the control, then kept 8px inside the window.
  useLayoutEffect(()=>{const node=ref.current;if(!node||!tip)return;const width=node.offsetWidth;node.style.left=`${Math.max(8,Math.min(tip.x-width/2,innerWidth-8-width))}px`;},[tip]);
  useEffect(()=>{
    let target:HTMLElement|null=null,timer=0;
    const restore=()=>{clearTimeout(timer);if(target?.dataset.title!==undefined){target.title=target.dataset.title;delete target.dataset.title;}if(target?.dataset.tipLabel!==undefined){target.removeAttribute("aria-label");delete target.dataset.tipLabel;}target=null;setTip(null);};
    const over=(event:PointerEvent)=>{
      const next=(event.target as Element|null)?.closest?.<HTMLElement>("[title],[data-title]")??null;
      if(next===target)return;
      restore();if(!next||!next.title)return;
      target=next;next.dataset.title=next.title;
      // An icon-only control is named by its title; keep that name for screen readers while it is parked.
      if(!next.hasAttribute("aria-label")&&!next.textContent?.trim()){next.setAttribute("aria-label",next.title);next.dataset.tipLabel="";}
      next.removeAttribute("title");
      timer=window.setTimeout(()=>{
        if(!target?.isConnected)return;
        const r=target.getBoundingClientRect(),raw=target.dataset.title!,match=/^(.*?)\s*\(([^()]+)\)$/.exec(raw),above=target.dataset.tip==="above"||r.bottom+48>innerHeight;
        setTip({text:match?match[1]!:raw,keys:match?match[2]!.split(/\s+/).filter(key=>key!=="/"&&key!=="then"):[],x:r.left+r.width/2,y:above?r.top-8:r.bottom+8,above});
      },500);
    };
    addEventListener("pointerover",over);addEventListener("pointerdown",restore,true);addEventListener("keydown",restore,true);addEventListener("scroll",restore,true);
    return()=>{restore();removeEventListener("pointerover",over);removeEventListener("pointerdown",restore,true);removeEventListener("keydown",restore,true);removeEventListener("scroll",restore,true);};
  },[]);
  if(!tip)return null;
  return <div ref={ref} role="tooltip" className="app-tooltip" style={{left:tip.x,top:tip.y,transform:tip.above?"translateY(-100%)":undefined}}>{tip.text}{tip.keys.map((key,index)=><kbd key={index}>{key}</kbd>)}</div>;
}
