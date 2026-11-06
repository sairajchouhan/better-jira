import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";

/** A shared focus trap with measured placement and a centered small-screen fallback. */
export function MenuSurface({label,children,close,anchorId,anchor,width=340}:{label:string;children:ReactNode;close:()=>void;anchorId?:string;anchor?:HTMLElement|null;width?:number}) {
  const ref=useRef<HTMLDivElement>(null),previous=useRef(document.activeElement as HTMLElement|null);
  const [style,setStyle]=useState<CSSProperties>();
  const anchored=!!anchorId||!!anchor;
  useLayoutEffect(()=>{
    const place=()=>{
      const node=ref.current,trigger=anchor??(anchorId?document.getElementById(anchorId):null)??previous.current;
      if(!node)return;
      const r=trigger?.getBoundingClientRect(),w=Math.min(width,innerWidth-24),h=Math.min(node.scrollHeight,innerHeight-24);
      if(anchored&&r?.width&&innerWidth>=600){
        const below=innerHeight-r.bottom-12,above=r.top-12;
        setStyle({position:"fixed",width:w,left:Math.max(12,Math.min(r.left,innerWidth-w-12)),top:Math.max(12,below>=h||below>=above?r.bottom+5:r.top-h-5),maxHeight:Math.max(100,Math.min(h,Math.max(below,above)))});
      }else setStyle({position:"fixed",width:Math.min(anchored?width:640,innerWidth-24),left:"50%",transform:"translateX(-50%)",top:"12vh",maxHeight:"80vh"});
    };
    place();const observer=new ResizeObserver(place);ref.current&&observer.observe(ref.current);
    window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    const frame=requestAnimationFrame(()=>ref.current?.querySelector<HTMLElement>('input:not([type="file"]),textarea,[contenteditable="true"],button,[tabindex="0"]')?.focus());
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);if(previous.current?.isConnected)previous.current.focus();};
  },[anchorId,anchor,anchored,width,label]);
  return <div className={`fixed inset-0 z-50 ${anchored?"":"bg-black/40"}`} onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <div ref={ref} style={style} role="dialog" aria-modal="true" aria-label={label} className="overflow-y-auto rounded-xl border border-line-2 bg-card p-3 text-fg-2 shadow-2xl" onKeyDown={e=>{
      e.stopPropagation();
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
