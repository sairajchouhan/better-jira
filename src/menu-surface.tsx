import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";

export const MENU_POPUP = "view-popup rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)]";
export const MENU_ITEM = "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-sel data-[selected=true]:bg-sel";
export const MENU_INPUT = "h-9 w-full border-b border-line-2 bg-transparent px-3 text-[13px] outline-none placeholder:text-fg-3";

const returnTargets=new WeakMap<Element,HTMLElement|null>();
/** A shared focus trap with measured placement and a centered small-screen fallback. */
/** `fit` sizes the surface to its content, like Linear's action menus. */
/** `command` places Linear's command menu (RAJ-52 "Mark as"): centred, 110px from the top, no backdrop or padding. */
/** `point` opens a right-click menu there (already offset by the caller), moved up or left to stay 10px inside the window (Linear, RAJ-52). */
/** `gap` is the space under the anchor; `side="left"` opens beside it instead, top 5.5px above its top (Linear's label menu, RAJ-52); `align="end"` lines up the right edges (its reaction picker). */
export function MenuSurface({label,children,close,anchorId,anchor,width=640,fit=false,gap=5,side,align,command=false,point}:{label:string;children:ReactNode;close:()=>void;anchorId?:string;anchor?:HTMLElement|null;width?:number;fit?:boolean;gap?:number;side?:"left";point?:{x:number;y:number};align?:"end";command?:boolean}) {
  const ref=useRef<HTMLDivElement>(null),previous=useRef(document.activeElement as HTMLElement|null);
  // Opened from inside another surface that is closing (a menu item opening a dialog): when that item is gone, focus returns to what opened the menu.
  const fallback=useRef(previous.current?.closest('[role="dialog"]')?returnTargets.get(previous.current.closest('[role="dialog"]')!)??null:null);
  const [style,setStyle]=useState<CSSProperties>();
  const anchored=!!anchorId||!!anchor||!!point;
  useLayoutEffect(()=>{
    const place=()=>{
      // The previously focused element is only a useful anchor when it is a real control, not <body> after keyboard navigation.
      const node=ref.current,last=previous.current,trigger=anchor??(anchorId?document.getElementById(anchorId):null)??(last&&last!==document.body?last:null);
      if(!node)return;
      const r=trigger?.getBoundingClientRect(),w=Math.min(fit?node.offsetWidth:width,innerWidth-24),h=Math.min(node.scrollHeight+node.offsetHeight-node.clientHeight,innerHeight-24); // scrollHeight leaves out the border, which max-height (border-box) includes
      if(point)setStyle({position:"fixed",width:fit?undefined:w,left:Math.max(10,Math.min(innerWidth-w-10,point.x)),top:Math.max(10,Math.min(innerHeight-h-10,point.y)),maxHeight:innerHeight-20});
      else if(command){const cw=Math.min(width,innerWidth-32);setStyle({position:"fixed",width:cw,left:(innerWidth-cw)/2,top:110,maxHeight:innerHeight-126});}
      else if(anchored&&r?.width&&innerWidth>=600){
        const below=innerHeight-r.bottom-12,above=r.top-12;
        const maxHeight=Math.max(100,Math.min(h,Math.max(below,above)));
        if(side==="left"&&r.left-w-gap>=12)setStyle({position:"fixed",width:fit?undefined:w,left:r.left-w-gap,top:Math.max(12,Math.min(innerHeight-h-12,r.top-5.5)),maxHeight:innerHeight-24});
        else setStyle({position:"fixed",width:fit?undefined:w,left:Math.max(12,Math.min(align==="end"?r.right-w:r.left,innerWidth-w-12)),top:Math.max(12,Math.min(innerHeight-maxHeight-12,below>=h||below>=above?r.bottom+gap:r.top-h-gap)),maxHeight});
      }else{setStyle({position:"fixed",width:fit?undefined:w,left:(innerWidth-w)/2,top:"12vh",maxHeight:"80vh"});} // no transform: it would re-anchor nested fixed menus
    };
    if(ref.current)returnTargets.set(ref.current,previous.current?.closest('[role="dialog"]')?fallback.current:previous.current);
    place();const observer=new ResizeObserver(place);ref.current&&observer.observe(ref.current);
    window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    // Keep focus a child already took (autoFocus); else prefer a text field over the first button in DOM order.
    const frame=requestAnimationFrame(()=>{const node=ref.current;if(!node||node.contains(document.activeElement))return;for(const selector of ["[data-autofocus]",'input:not([type="file"]):not([type="checkbox"]),textarea,[contenteditable="true"]','button,[tabindex="0"]']){const target=node.querySelector<HTMLElement>(selector);if(target){target.focus();return;}}});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);(previous.current?.isConnected?previous.current:fallback.current?.isConnected?fallback.current:null)?.focus();};
  },[anchorId,anchor,anchored,width,label,gap,side,align,command,point?.x,point?.y]);
  return <div className={`fixed inset-0 z-50 ${anchored||command?"":"bg-black/40"}`} onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <div ref={ref} style={style} role="dialog" aria-modal="true" aria-label={label} className={`overflow-y-auto rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)] ${fit?"w-max min-w-[175px] max-w-[min(520px,calc(100vw-24px))]":command?"flex flex-col overflow-hidden":"p-3"}`} onKeyDown={e=>{
      if(!((e.metaKey||e.ctrlKey)&&["k","/"].includes(e.key.toLowerCase())))e.stopPropagation(); // ⌘K reaches the app so it can toggle the command menu
      if(e.key==="Escape"){e.preventDefault();close();}
      if(e.key==="Tab"){
        const nodes=[...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([type="file"]),textarea,select,[contenteditable="true"],[tabindex="0"]')].filter(n=>n.getClientRects().length);
        if(!nodes.length){e.preventDefault();return;}
        if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}
      }
    }}>{children}</div>
  </div>;
}

/** A property row in the open issue, else the issue's visible card, so pickers open beside what they change. */
export function issueAnchor(id:string,key:string):HTMLElement|null {
  return document.getElementById(id)??[...document.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)].find(n=>n.getClientRects().length)??null;
}

/** Linear's destructive confirmation: focus starts on the action, Escape or Cancel keeps things as they were. */
export function Confirm({title,detail,action,onConfirm,close}:{title:string;detail:string;action:string;onConfirm:()=>void;close:()=>void}) {
  return <MenuSurface label={title} close={close} width={360}><h2 className="text-[14px] font-medium text-fg">{title}</h2><p className="mt-1 mb-4 text-[13px] text-fg-3">{detail}</p><div className="flex justify-end gap-2 text-[13px]"><button type="button" className="rounded border border-line-2 px-3 py-1 hover:bg-hover" onClick={close}>Cancel</button><button type="button" data-autofocus className="rounded bg-red-600 px-3 py-1 text-white" onClick={onConfirm}>{action}</button></div></MenuSurface>;
}
