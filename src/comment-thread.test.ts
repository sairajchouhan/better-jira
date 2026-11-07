import {expect,test} from 'bun:test';
import {canReplyTo,visibleComments,visibleCommentTotal,validCommentStates,type IssueComment} from './comment-thread';
const body={type:'doc' as const,version:1 as const,content:[]};
const comments:IssueComment[]=[{id:'jira-1',body,created:'now'},{id:'local-1',parentId:'jira-1',body,created:'now'},{id:'jira-2',body,created:'now'}];
test('local comment metadata overlays a fresh Jira response and preserves server totals',()=>{
 const changed={...body,content:[{type:'paragraph',content:[{type:'text',text:'Edited locally'}]}]};
 expect(visibleComments(comments,{'jira-1':{body:changed}})[0]?.body).toEqual(changed);
 expect(visibleComments(comments,{'jira-1':{deleted:true}}).map(c=>c.id)).toEqual(['jira-2']);
 expect(visibleCommentTotal(15,comments,{'jira-1':{deleted:true}})).toBe(13);
 expect(validCommentStates({'jira-1':{resolved:true,reactions:['💙'],body:changed}})).toBe(true);
 expect(validCommentStates({'jira-1':{resolved:'yes'}})).toBe(false);
});
test('a recovered thread remains connected when its remote ancestor returns',()=>{
 const orphan:IssueComment={id:'local-1',parentId:'jira-1',body,created:'now'},reply:IssueComment={id:'local-2',parentId:'local-1',body,created:'now'};
 expect(canReplyTo([orphan],orphan.id)).toBe(true);expect(canReplyTo([comments[0]!,orphan],orphan.id)).toBe(false);
 expect(visibleComments([orphan,reply]).map(c=>[c.id,c.parentId])).toEqual([['local-1',undefined],['local-2','local-1']]);
 expect(visibleComments([comments[0]!,orphan,reply]).map(c=>[c.id,c.parentId])).toEqual([['jira-1',undefined],['local-1','jira-1'],['local-2','jira-1']]);
 expect(visibleComments([comments[0]!,orphan,reply],{'jira-1':{deleted:true}})).toHaveLength(0);
});
