/** Local property history, kept the way Linear keeps an actor's edits (observed on RAJ-52, 2026-11-07/08):
 * an edit joins the actor's latest group while that group was last edited under GROUP_MS ago, and the group keeps its first time;
 * a field already in the group is updated, and hidden (but kept) when it returns to its value before the group. */
export const activityFields=['status','priority','assignee','labels','due','parent'] as const;
export type ActivityField=typeof activityFields[number]|'relation';
export type Relation={key:string;kind:string};
/** The other issue's role, as Linear's Issue options › Remove names it (RAJ-52): a blocked-by relation lists the "Blocking issue". */
export const RELATION_ISSUE:Record<string,string>={blocked:"blocking",blocking:"blocked",related:"related",duplicate:"duplicate"};
/** `at` is the group's time; `updated` is when the group was last edited. */
export type PropertyActivity={id:string;field:ActivityField;before:unknown;after:unknown;actor:{id:string;name:string};at:string;updated?:string};
// RAJ-52: edits 30.5 min, 5 min and about 60 min after the group's last edit joined it; one 62.7 min after started a new group.
// ponytail: the cut-off is in [60, 62.7] min; 60 is the round number inside it.
export const GROUP_MS=60*60_000;

const identity=(value:unknown):unknown=>Array.isArray(value)?[...new Set(value)].sort():value&&typeof value==='object'&&'id' in value?(value as {id:unknown}).id:value??null;
export const sameValue=(a:unknown,b:unknown)=>JSON.stringify(identity(a))===JSON.stringify(identity(b));

/** Events that changed something; a field edited back to its value before the group is not shown. */
export const visibleActivity=(events:readonly PropertyActivity[])=>events.filter(event=>!sameValue(event.before,event.after));

export function recordActivity(events:readonly PropertyActivity[],before:Record<string,unknown>,patch:Record<string,unknown>,actor:{id:string;name:string},now:string,id:()=>string):readonly PropertyActivity[]{
 const changes=activityFields.filter(field=>field in patch&&!sameValue(before[field],patch[field]));
 const properties=events.filter(event=>event.field!=='relation'),last=properties.at(-1),group=last?properties.filter(event=>event.at===last.at&&event.actor.id===last.actor.id):[];
 const touched=Math.max(...group.map(event=>Date.parse(event.updated??event.at)));
 const open=!!last&&last.actor.id===actor.id&&Date.parse(now)-touched<GROUP_MS;
 // A description edit is not listed, but (RAJ-52, 21:07Z) it moves the actor's open group to its time.
 const bump=open&&'description' in patch&&!sameValue(before.description,patch.description);
 if(!changes.length&&!bump)return events;
 const at=open&&!bump?last!.at:now;
 let next=open?events.map(event=>group.includes(event)?{...event,at,updated:now}:event):[...events];
 for(const field of changes){
  const index=next.findIndex(event=>event.at===at&&event.actor.id===actor.id&&event.field===field),after=structuredClone(patch[field]??null);
  if(index<0)next.push({id:id(),field,before:structuredClone(before[field]??null),after,actor:{...actor},at,updated:now});
  else next[index]={...next[index]!,after,updated:now};
 }
 return next;
}

/** Linear (RAJ-52): each relation change is its own Activity row, and removing a relation added under GROUP_MS ago drops that row.
 *  ponytail: Linear's row for removing an older relation was not observed; ours reads "removed <kind> issue". */
export function recordRelation(events:readonly PropertyActivity[],relation:Relation,remove:boolean,actor:{id:string;name:string},now:string,id:()=>string):readonly PropertyActivity[]{
 const same=(value:unknown)=>!!value&&(value as Relation).key===relation.key&&(value as Relation).kind===relation.kind;
 const added=remove?events.findLastIndex(event=>event.field==='relation'&&event.before===null&&same(event.after)&&event.actor.id===actor.id&&Date.parse(now)-Date.parse(event.at)<GROUP_MS):-1;
 if(added>=0)return events.toSpliced(added,1);
 return [...events,{id:id(),field:'relation',before:remove?{...relation}:null,after:remove?null:{...relation},actor:{...actor},at:now}];
}

/** One Activity row. Linear (RAJ-52) gives a status change its own row; the group's other changes share one row ("removed priority and added label").
 *  A row of one change that follows the same actor's row of the same field, with nothing else in either group, joins it: "set priority to Low, then removed priority", at the later time. */
export type ActivityRow={id:string;actor:{id:string;name:string};at:string;field:ActivityField|'multi';events:PropertyActivity[];chain:PropertyActivity[]};
export function activityRows(events:readonly PropertyActivity[]):ActivityRow[]{
 const groups=new Map<string,PropertyActivity[]>();
 for(const event of [...visibleActivity(events)].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(activityFields as readonly string[]).indexOf(a.field)-(activityFields as readonly string[]).indexOf(b.field))){const key=`${event.actor.id} ${event.at}${event.field==='relation'?` ${event.id}`:''}`;groups.set(key,[...groups.get(key)??[],event]);}
 const rows:ActivityRow[]=[];let previous:ActivityRow|undefined;
 for(const group of groups.values()){
  const status=group.filter(event=>event.field==='status'),rest=group.filter(event=>event.field!=='status');
  const own=[...status.map(event=>[event]),...rest.length?[rest]:[]].map(list=>({id:list[0]!.id,actor:list[0]!.actor,at:list[0]!.at,field:list.length>1?'multi' as const:list[0]!.field,events:list,chain:[]}));
  const single=own.length===1&&own[0]!.events.length===1?own[0]!:undefined;
  if(single&&single.field!=='relation'&&previous&&previous===rows.at(-1)&&previous.actor.id===single.actor.id&&previous.field===single.field){previous.chain.push(single.events[0]!);previous.at=single.at;continue;}
  rows.push(...own);previous=single;
 }
 return rows;
}
