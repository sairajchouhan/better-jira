import type {AdfDocument} from './document';
export type CommentState={resolved?:boolean;subscribed?:boolean;reactions?:string[];body?:AdfDocument;updated?:string;deleted?:boolean};
export type IssueComment={id:string;parentId?:string;orphanedFrom?:string;body:AdfDocument;created:string;updated?:string;author?:{accountId:string;displayName:string;avatarUrls?:Record<string,string>}};
export function visibleComments(comments:IssueComment[],states:Record<string,CommentState>={}){
 const byId=new Map(comments.map(c=>[c.id,c]));
 return comments.flatMap(comment=>{
  let root=comment;
  const visited=new Set<string>();
  while(true){
   if(states[root.id]?.deleted||root.parentId&&states[root.parentId]?.deleted)return [];
   visited.add(root.id);
   const parent=root.parentId?byId.get(root.parentId):undefined;
   if(!parent)break;
   // A malformed cycle has no root. Recover its comments rather than losing them.
   if(visited.has(parent.id)){root=comment;break;}
   root=parent;
  }
  const state=states[comment.id];
  return [{...comment,parentId:root.id===comment.id?undefined:root.id,orphanedFrom:root.id===comment.id?root.parentId:undefined,...(state?.body?{body:state.body,updated:state.updated}:{})}];
 });
}
export function visibleCommentTotal(total:number,comments:IssueComment[],states:Record<string,CommentState>={}){return Math.max(0,total-comments.length+visibleComments(comments,states).length);}
export function validCommentStates(value:unknown,document?:(value:unknown)=>boolean):boolean {
 if(value===undefined)return true;if(!value||typeof value!=='object'||Array.isArray(value))return false;
 return Object.values(value).every(s=>s&&typeof s==='object'&&['resolved','subscribed','deleted'].every(k=>s[k]===undefined||typeof s[k]==='boolean')&&(s.reactions===undefined||Array.isArray(s.reactions)&&s.reactions.every((r:unknown)=>typeof r==='string'))&&(s.updated===undefined||typeof s.updated==='string')&&(s.body===undefined||s.body?.type==='doc'&&Array.isArray(s.body.content)&&(!document||document(s.body))));
}

export function canReplyTo(comments:IssueComment[],id:string,states:Record<string,CommentState>={}){
 const root=comments.find(c=>c.id===id);return !!root&&!states[id]?.deleted&&(!root.parentId||!comments.some(c=>c.id===root.parentId));
}
