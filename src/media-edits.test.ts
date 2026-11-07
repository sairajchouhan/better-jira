import {expect,test} from 'bun:test';
import {adjustCrop,commentCount,externalMediaId,validCrop,validMediaEdits} from './media-edits';
test('crop movement and resizing stay inside the source and retain a nonempty selection',()=>{
 const crop={x:.2,y:.2,width:.5,height:.5};
 expect(adjustCrop(crop,'move',5,5)).toEqual({x:.5,y:.5,width:.5,height:.5});
 expect(validCrop(adjustCrop(crop,'top left',5,5))).toBe(true);
 expect(validCrop({x:.5,y:0,width:1,height:1})).toBe(false);
 expect(validMediaEdits({id:{crop,comments:[{id:'1',text:'Review',author:'Me',at:'2026-11-07'}]}})).toBe(true);
 expect(validMediaEdits({id:{crop:{...crop,width:Infinity}}})).toBe(false);
 expect(validMediaEdits({id:{src:'/api/issues/TEST-2/attachments/1'}})).toBe(true);expect(validMediaEdits({id:{src:5}})).toBe(false);
});
test('image identity hides URL tokens and comment badges derive independent totals',()=>{
 const url='https://example.test/picture.png?token=private';
 expect(externalMediaId(url)).toBe(externalMediaId(url));expect(externalMediaId(url)).toMatch(/^external-[a-f0-9]{16}$/);expect(externalMediaId(url)).not.toContain('private');expect(externalMediaId(url+'2')).not.toBe(externalMediaId(url));
 expect(commentCount({comments:2,mediaEdits:{image:{comments:[{id:'1',text:'Review',author:'Me',at:'now'}]}}})).toBe(3);
});
