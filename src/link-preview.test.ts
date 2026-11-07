import {expect,test} from 'bun:test';
import {previewFrom} from './link-preview';
test('a link preview reads the meta description, else the first paragraph, and resolves the icon',async()=>{
 expect(await previewFrom('<title> Example\nDomain </title><body><h1>x</h1><p>This domain is <b>for</b> use.</p><p>second</p></body>','https://example.com/a')).toEqual({title:'Example Domain',description:'This domain is for use.',icon:'https://example.com/favicon.ico'});
 expect(await previewFrom('<head><meta property="og:title" content="OG"><meta name="description" content="Meta text"><link rel="shortcut icon" href="/i.png"></head><p>para</p>','https://site.dev/x/y')).toEqual({title:'OG',description:'Meta text',icon:'https://site.dev/i.png'});
 expect((await previewFrom('<link rel="icon" href="javascript:alert(1)">','https://a.b/')).icon).toBeUndefined();
});
