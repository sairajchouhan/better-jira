import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";

export const MENU_POPUP = "view-popup rounded-xl border border-line-2 bg-card text-fg-2 shadow-[0_12px_40px_rgb(0_0_0/0.35)]";
export const MENU_ITEM = "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover";
export const MENU_INPUT = "h-9 w-full border-b border-line-2 bg-transparent px-3 text-[13px] outline-none placeholder:text-fg-3";

/** A shared focus trap with measured placement and a centered small-screen fallback. */
export function MenuSurface({label,children,close,anchorId,anchor,width=640}:{label:string;children:ReactNode;close:()=>void;anchorId?:string;anchor?:HTMLElement|null;width?:number}) {
  const ref=useRef<HTMLDivElement>(null),previous=useRef(document.activeElement as HTMLElement|null);
  const [style,setStyle]=useState<CSSProperties>();
  const anchored=!!anchorId||!!anchor;
  useLayoutEffect(()=>{
    const place=()=>{
      // The previously focused element is only a useful anchor when it is a real control, not <body> after keyboard navigation.
      const node=ref.current,last=previous.current,trigger=anchor??(anchorId?document.getElementById(anchorId):null)??(last&&last!==document.body?last:null);
      if(!node)return;
      const r=trigger?.getBoundingClientRect(),w=Math.min(width,innerWidth-24),h=Math.min(node.scrollHeight,innerHeight-24);
      if(anchored&&r?.width&&innerWidth>=600){
        const below=innerHeight-r.bottom-12,above=r.top-12;
        const maxHeight=Math.max(100,Math.min(h,Math.max(below,above)));
        setStyle({position:"fixed",width:w,left:Math.max(12,Math.min(r.left,innerWidth-w-12)),top:Math.max(12,Math.min(innerHeight-maxHeight-12,below>=h||below>=above?r.bottom+5:r.top-h-5)),maxHeight});
      }else{const w=Math.min(width,innerWidth-24);setStyle({position:"fixed",width:w,left:(innerWidth-w)/2,top:"12vh",maxHeight:"80vh"});} // no transform: it would re-anchor nested fixed menus
    };
    place();const observer=new ResizeObserver(place);ref.current&&observer.observe(ref.current);
    window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    // Keep focus a child already took (autoFocus); else prefer a text field over the first button in DOM order.
    const frame=requestAnimationFrame(()=>{const node=ref.current;if(!node||node.contains(document.activeElement))return;for(const selector of ["[data-autofocus]",'input:not([type="file"]):not([type="checkbox"]),textarea,[contenteditable="true"]','button,[tabindex="0"]']){const target=node.querySelector<HTMLElement>(selector);if(target){target.focus();return;}}});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);if(previous.current?.isConnected)previous.current.focus();};
  },[anchorId,anchor,anchored,width,label]);
  return <div className={`fixed inset-0 z-50 ${anchored?"":"bg-black/40"}`} onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <div ref={ref} style={style} role="dialog" aria-modal="true" aria-label={label} className="overflow-y-auto rounded-xl border border-line-2 bg-card p-3 text-fg-2 shadow-2xl" onKeyDown={e=>{
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
