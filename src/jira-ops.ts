import { textToAdf, type AdfDocument } from "./document";
import type { Full, Issue } from "./store";
import type { CommentState, IssueComment } from "./comment-thread";

/** `labels` sets the whole list (create); `labelEdits` adds and removes single labels so others' labels survive. */
type Fields={summary?:string;description?:AdfDocument;priority?:string|null;assignee?:string|null;labels?:string[];labelEdits?:{add:string[];remove:string[]};due?:string|null;parent?:string|null;milestones?:string[];estimate?:number|null;type?:string;project?:string|null};
/** One Jira change. The client derives these from an edit's before and after state; the server runs them. */
export type Op =
  | {op:"fields";fields:Fields}
  | {op:"status";status:string}
  | {op:"watcher";id:string;add:boolean}
  | {op:"attachment.add";id:string;name:string}
  | {op:"attachment.delete";id:string}
  | {op:"rank";after?:string;before?:string}
  | {op:"create";fields:Fields&{status?:string}}
  | {op:"delete"}
  /** `ref` is the app's id for the new comment; the server answers with Jira's id for it. */
  | {op:"comment";ref:string;body:AdfDocument;parentId?:string}
  | {op:"comment.edit";id:string;body:AdfDocument}
  | {op:"comment.delete";id:string}
  | {op:"link";target:string;kind:string;remove?:boolean}
  /** A link resource, kept in Jira as a remote ("web") link keyed by its URL. */
  | {op:"weblink";url:string;title:string;remove?:boolean};

export type Side={issue?:Issue;full?:Full};
/** Comment property that keeps Linear-style reply threads; Jira comments are flat. */
export const THREAD_PROPERTY="better-jira";

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Issue fields that live in Jira. Everything else on an Issue is local (reminders, resources, activity...). */
export const JIRA_ISSUE_FIELDS=["summary","description","status","priority","assignee","labels","due","parent","milestones","estimate","type","typeIcon","project","rank","resolved","watchers","watchersComplete","attachments","statusSince","started","updated","relations","comments"] as const;

function fieldChanges(a:Issue,b:Issue):Fields {
  const fields:Fields={};
  if(a.summary!==b.summary)fields.summary=b.summary;
  if((a.priority??null)!==(b.priority??null))fields.priority=b.priority??null;
  if((a.assignee?.id??null)!==(b.assignee?.id??null))fields.assignee=b.assignee?.id??null;
  if(!same([...a.labels].sort(),[...b.labels].sort()))fields.labels=b.labels;
  if((a.due??null)!==(b.due??null))fields.due=b.due??null;
  if((a.parent??null)!==(b.parent??null))fields.parent=b.parent??null;
  if(!same((a.milestones??[]).map(m=>m.id).sort(),(b.milestones??[]).map(m=>m.id).sort()))fields.milestones=(b.milestones??[]).map(m=>m.id);
  if((a.estimate??null)!==(b.estimate??null))fields.estimate=b.estimate??null;
  if(a.type!==b.type&&b.type)fields.type=b.type;
  if((a.project?.key??null)!==(b.project?.key??null))fields.project=b.project?.key??null;
  return fields;
}

const relationId=(r:{key:string;kind:string})=>`${r.kind} ${r.key}`;
/** relate() edits both issues; only one side sends the Jira link. */
function sendsLink(key:string,r:{key:string;kind:string},issues:Map<string,Issue>) {
  if(r.kind==="blocking"||r.kind==="duplicate")return true;
  if(r.kind==="blocked"||r.kind==="duplicated")return !issues.has(r.key);
  return key<r.key||!issues.has(r.key);
}
function linkOps(key:string,a:Issue["relations"]=[],b:Issue["relations"]=[],issues:Map<string,Issue>):Op[] {
  const before=new Set(a.map(relationId)),after=new Set(b.map(relationId));
  return [
    ...b.filter(r=>!before.has(relationId(r))&&sendsLink(key,r,issues)).map(r=>({op:"link" as const,target:r.key,kind:r.kind})),
    ...a.filter(r=>!after.has(relationId(r))&&sendsLink(key,r,issues)).map(r=>({op:"link" as const,target:r.key,kind:r.kind,remove:true})),
  ];
}

type Resources=Issue["resources"];
function webLinkOps(a:Resources=[],b:Resources=[]):Op[] {
  const urls=(list:NonNullable<Resources>)=>new Map(list.filter(r=>r.kind==="link"&&r.url).map(r=>[r.url!,r]));
  const before=urls(a),after=urls(b);
  return [
    ...[...after].filter(([url,r])=>before.get(url)?.title!==r.title).map(([url,r]):Op=>({op:"weblink",url,title:r.title})),
    ...[...before.keys()].filter(url=>!after.has(url)).map((url):Op=>({op:"weblink",url,title:before.get(url)!.title,remove:true})),
  ];
}

function commentOps(before:Side,after:Side):Op[] {
  if(!after.full)return [];
  const listA:IssueComment[]=before.full?.fields.comment?.comments??[],listB:IssueComment[]=after.full.fields.comment?.comments??[];
  const statesA:Record<string,CommentState>=before.issue?.commentStates??{},statesB:Record<string,CommentState>=after.issue?.commentStates??{};
  const inA=new Map(listA.map(c=>[c.id,c])),inB=new Map(listB.map(c=>[c.id,c]));
  const ops:Op[]=[];
  const create=(c:IssueComment)=>ops.push({op:"comment",ref:c.id,body:statesB[c.id]?.body??c.body,...(c.parentId?{parentId:c.parentId}:{})});
  for(const c of listB) {
    const sa=statesA[c.id],sb=statesB[c.id];
    if(!inA.has(c.id)){if(!sb?.deleted)create(c);continue;}
    if(sb?.deleted&&!sa?.deleted)ops.push({op:"comment.delete",id:c.id});
    else if(sa?.deleted&&!sb?.deleted)create(c);
    else if(!sb?.deleted&&!same(sa?.body??inA.get(c.id)!.body,sb?.body??c.body))ops.push({op:"comment.edit",id:c.id,body:sb?.body??c.body});
  }
  for(const c of listA)if(!inB.has(c.id)&&!statesA[c.id]?.deleted)ops.push({op:"comment.delete",id:c.id});
  return ops;
}

/** Image thread comments are real Jira comments; only their place on the image (mediaEdits) stays local. */
function imageCommentOps(a:Issue|undefined,b:Issue):Op[] {
  const list=(issue?:Issue)=>new Map(Object.values(issue?.mediaEdits??{}).flatMap(edit=>edit.comments??[]).map(c=>[c.id,c]));
  const before=list(a),after=list(b),ops:Op[]=[];
  for(const [id,c] of after){const old=before.get(id);if(!old)ops.push({op:"comment",ref:id,body:textToAdf(c.text)});else if(old.text!==c.text)ops.push({op:"comment.edit",id,body:textToAdf(c.text)});}
  for(const id of before.keys())if(!after.has(id))ops.push({op:"comment.delete",id});
  return ops;
}

/** The Jira ops that turn `before` into `after` for one issue. `issues` supplies rank neighbours and linked issues. */
export function opsFor(before:Side,after:Side,issues:Map<string,Issue>):Op[] {
  const a=before.issue,b=after.issue;
  if(!b)return a?[{op:"delete"}]:[];
  if(!a) {
    const blank:Issue={...b,summary:"",priority:undefined,assignee:null,labels:[],due:null,parent:undefined,milestones:[],estimate:undefined,type:undefined,project:null};
    const {project:_,...fields}=fieldChanges(blank,b),description=after.full?.fields.description;
    return [
      {op:"create",fields:{...fields,project:b.project?.key??null,status:b.status,...(description?.content?.length?{description}:{})}},
      ...(b.attachments??[]).map((file):Op=>({op:"attachment.add",id:file.id,name:file.name})),
      ...linkOps(b.key,[],b.relations,issues),
      ...webLinkOps([],b.resources),
      ...commentOps({},after),
      ...imageCommentOps(undefined,b),
    ];
  }
  const {labels,...changed}=fieldChanges(a,b),ops:Op[]=[];
  const fields:Fields=labels?{...changed,labelEdits:{add:b.labels.filter(l=>!a.labels.includes(l)),remove:a.labels.filter(l=>!b.labels.includes(l))}}:changed;
  const da=before.full?.fields.description,db=after.full?.fields.description;
  if(after.full&&db!==undefined&&!same(da,db))fields.description=db;
  if(Object.keys(fields).length)ops.push({op:"fields",fields});
  if(a.status!==b.status)ops.push({op:"status",status:b.status});
  if(b.rank!==undefined&&a.rank!==b.rank) {
    const peers=[...issues.values()].filter(i=>i.board===b.board&&i.key!==b.key&&i.rank!==undefined);
    const prev=peers.filter(i=>i.rank!<b.rank!).sort((x,y)=>x.rank!<y.rank!?1:-1)[0];
    const next=peers.filter(i=>i.rank!>b.rank!).sort((x,y)=>x.rank!<y.rank!?-1:1)[0];
    if(prev)ops.push({op:"rank",after:prev.key});else if(next)ops.push({op:"rank",before:next.key});
  }
  for(const user of b.watchers??[])if(!a.watchers?.some(u=>u.id===user.id))ops.push({op:"watcher",id:user.id,add:true});
  for(const user of a.watchers??[])if(!b.watchers?.some(u=>u.id===user.id))ops.push({op:"watcher",id:user.id,add:false});
  for(const file of b.attachments??[])if(!a.attachments?.some(f=>f.id===file.id))ops.push({op:"attachment.add",id:file.id,name:file.name});
  for(const file of a.attachments??[])if(!b.attachments?.some(f=>f.id===file.id))ops.push({op:"attachment.delete",id:file.id});
  ops.push(...linkOps(b.key,a.relations,b.relations,issues),...webLinkOps(a.resources,b.resources),...commentOps(before,after),...imageCommentOps(a,b));
  return ops;
}

/** Appends later ops for the same issue. Field edits fold into one; the last status and rank win; the rest keep their order. */
export function mergeOps(first:Op[],second:Op[]):Op[] {
  const out=[...first];
  for(const op of second) {
    // An upload and its undo cancel out; a watcher's last add or remove wins.
    if(op.op==="attachment.add"||op.op==="attachment.delete"){
      const inverse=out.findIndex(o=>(o.op==="attachment.add"||o.op==="attachment.delete")&&o.id===op.id&&o.op!==op.op);
      if(inverse>=0){out.splice(inverse,1);continue;}
    }
    const index=op.op==="watcher"?out.findIndex(o=>o.op==="watcher"&&o.id===op.id):["fields","status","rank"].includes(op.op)?out.findIndex(o=>o.op===op.op):-1;
    if(index<0)out.push(op);
    else if(op.op==="fields") {
      const first=(out[index] as typeof op).fields,a=first.labelEdits,b=op.fields.labelEdits;
      const labelEdits=a&&b?{add:[...new Set([...a.add.filter(l=>!b.remove.includes(l)),...b.add])],remove:[...new Set([...a.remove.filter(l=>!b.add.includes(l)),...b.remove])]}:b??a;
      out[index]={op:"fields",fields:{...first,...op.fields,...(labelEdits?{labelEdits}:{})}};
    }
    else out[index]=op;
  }
  return out;
}

/** Swaps comment ids only where a comment id can sit, so a Jira comment id never rewrites an equal status, version or attachment id. */
export function renameCommentIds<T>(value:T,ids:Map<string,string>):T {
  if(!ids.size)return value;
  const walk=(v:any,at?:string):any=>{
    if(Array.isArray(v))return v.map(x=>walk(x,at==="comments"?"comment":undefined));
    if(!v||typeof v!=="object")return v;
    const comment=at==="comment"||typeof v.op==="string"&&v.op.startsWith("comment"),out:any={};
    for(const [k,x] of Object.entries(v)) {
      if(at==="commentStates")out[ids.get(k)??k]=walk(x,k);
      else out[k]=comment&&["id","ref","parentId"].includes(k)&&typeof x==="string"?ids.get(x)??x:walk(x,k);
    }
    return out;
  };
  return walk(value);
}

/** Swaps app issue keys (PREFIX-NEWn, unique by shape) for Jira's once Jira has assigned them. */
export function renameIds<T>(value:T,ids:Map<string,string>):T {
  if(!ids.size)return value;
  return JSON.parse(JSON.stringify(value),(_,v)=>typeof v==="string"&&ids.has(v)?ids.get(v):v);
}
