import {Command} from "cmdk";
import type {ReactNode} from "react";
import {Icon} from "./icons";
import {MenuSurface} from "./menu-surface";

/** A 32px row inset 6px, icon box at 15px, text at 39px, then the check and the row's number key (Linear, RAJ-52). */
export const PICKER_ITEM = "picker-item";

/** Linear's property menu (RAJ-52 status, priority, assignee and labels): 208px wide, a 36px filter with the key that opens it at its right,
 *  rows 6px below. With an empty filter, a row's number key picks it, as in Linear. */
export function PropertyMenu({label,placeholder,hotkey,anchor,close,current,query,onQuery,side,onKeyDown,children}:{label:string;placeholder:string;hotkey?:string;anchor:HTMLElement|null;close:()=>void;current?:string;query?:string;onQuery?:(value:string)=>void;side?:"left";onKeyDown?:(event:React.KeyboardEvent<HTMLDivElement>)=>void;children:ReactNode}){
  return <MenuSurface label={label} anchor={anchor} close={close} fit gap={4.5} side={side}>
    <Command loop defaultValue={current} className="property-menu" onKeyDown={event=>{
      onKeyDown?.(event);if(event.defaultPrevented)return;
      const input=event.target instanceof HTMLInputElement?event.target:null;
      if(/^\d$/.test(event.key)&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&input&&!input.value){const row=event.currentTarget.querySelector<HTMLElement>(`[cmdk-item][data-number="${event.key}"]`);if(row){event.preventDefault();row.click();}}
    }}>
      <div className="flex h-[37px] items-center gap-3.5 border-b border-[var(--menu-line)] pr-3 pl-3.5">
        <Command.Input autoFocus placeholder={placeholder} value={query} onValueChange={onQuery} className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-fg-2 outline-none placeholder:text-fg-3"/>
        {hotkey&&<kbd className="property-menu-key">{hotkey}</kbd>}
      </div>
      <Command.List className="max-h-[min(400px,calc(100vh-80px))] overflow-y-auto py-1.5">
        <Command.Empty className="px-3.5 py-2 text-[13px] text-fg-3">No results</Command.Empty>
        {children}
      </Command.List>
    </Command>
  </MenuSurface>;
}

/** One choice: its icon, name, a check when it is the current value, and its number key. */
export function PickerRow({value,icon,current,number,keywords,onSelect,children}:{value:string;icon?:ReactNode;current?:boolean;number?:number;keywords?:string[];onSelect:()=>void;children:ReactNode}){
  return <Command.Item value={value} keywords={keywords} data-number={number} onSelect={onSelect} className={PICKER_ITEM}>
    <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {current&&<Icon name="check" size={16}/>}
    {number!==undefined&&<kbd className="picker-number">{number}</kbd>}
  </Command.Item>;
}
