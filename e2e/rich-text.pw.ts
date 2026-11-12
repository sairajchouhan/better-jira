import { resolve } from "node:path";
import { expect, test, sleep, fixture } from "./app";

// QA round 1, group G2: rich text, ADF and media.

const fixtureFiles = (...names: string[]) => names.map((name) => resolve(`e2e/fixtures/${name}`));
/** A writable site faked in the page; `extra` handles more routes first (return undefined to fall through). */
const writable = (extra = "") => `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 ${extra}
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 return Response.json({key:m[1],created:{},others:[],issue});
};})()`;

test("the full-page description editor: toolbar state, tables, drops, rendering and the comment toolbar", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await test.step("R1-D81: the toolbar's style and list menus name the block the selection is in", async () => {
    const shows = (label: string) => page.eval(`document.querySelector('[aria-label="${label}"]')?.textContent`);
    await page.click("#description h2");
    await page.key("End");
    await page.key("ArrowLeft", "shift");
    await page.waitFor(`!!document.querySelector('[aria-label="Text style"]')`);
    expect(await shows("Text style")).toBe("Heading 2");
    // Collapse the selection so the toolbar (over the list since BJ-176's 22px rhythm) closes before the click.
    await page.key("ArrowRight");
    await page.click("#description li p");
    await page.key("End");
    await page.key("ArrowLeft", "shift");
    await page.waitFor(`document.querySelector('[aria-label="Text style"]')?.disabled===true`);
    await page.click('[aria-label="List"]');
    expect(
      await page.eval(`[...document.querySelectorAll('[aria-label="List"] [cmdk-item] .menu-name')].map(n=>n.textContent)`),
    ).toEqual(expect.arrayContaining(["List", "Numbered list", "Checklist"]));
    await page.key("Escape");
  });
  await test.step("R1-D12: after the slash Table the selection toolbar does not cover the new table", async () => {
    await page.click("#description p");
    await page.key("End");
    await page.key("Enter");
    await page.type("/table");
    await page.key("Enter");
    await page.waitFor(`document.querySelectorAll('#description table').length===2`);
    await sleep(100);
    expect(await page.eval(`!!document.querySelector('[aria-label="Description formatting"]')`)).toBe(false);
    expect(await page.eval(`document.querySelector('#description p').textContent`)).toBe("Formatted fixture");
  });
  await test.step("R1-D20: a file dropped at a block's start goes before it, leaving no empty block", async () => {
    await page.eval(
      `(()=>{const node=document.getElementById('description'),r=node.querySelector('h2').getBoundingClientRect(),data=new DataTransfer();data.items.add(new File(['Dropped fixture'],'dropped.txt',{type:'text/plain'}));node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true,clientX:r.x+1,clientY:r.y+r.height/2}))})()`,
    );
    await page.waitFor(
      `document.getElementById('description').textContent.includes('dropped.txt')`,
    );
    expect(
      await page.eval(
        `[...document.getElementById('description').children].filter(n=>n.matches('p,h1,h2,h3,h4,h5,h6')&&!n.textContent&&!n.hasAttribute('data-media-caret')).length`,
      ),
    ).toBe(0);
    expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe(
      "Rich fixture heading",
    );
  });
  await test.step("R1-D31/D78: the comment composer's toolbar sits beside its buttons, so the paperclip is clickable, and it names the comment", async () => {
    const side = await open(`?issue=TEST-2&view=side`);
    for (const p of [page, side]) {
      await p.click("#comment");
      await p.type("QA paperclip test");
      const toolbar = '.rich-editor:has(#comment) [role="toolbar"]';
      await p.waitFor(`!!document.querySelector('${toolbar}')?.offsetWidth`);
      expect(await p.eval(`document.querySelector('${toolbar}').getAttribute('aria-label')`)).toBe(
        "Comment formatting",
      );
      expect(await p.eval(`!!document.querySelector('${toolbar} [aria-label="Bold"]')`)).toBe(true);
      expect(
        await p.eval(
          `(()=>{const b=document.querySelector('.rich-editor:has(#comment) [aria-label="Attach images, files, or videos"]'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
        ),
      ).toBe(true);
    }
  });
  await test.step("R1-D80: smart links open as links, dates read as dates and expands show their title", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: `(()=>{const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
        if(path!=='/api/issues/TEST-2')return real(input,init);const full=await (await real(input,init)).json();
        full.fields.description={type:'doc',version:1,content:[
         {type:'paragraph',content:[{type:'inlineCard',attrs:{url:'https://example.com/card'}},{type:'text',text:' due '},{type:'date',attrs:{timestamp:'1767225600000'}}]},
         {type:'blockCard',attrs:{url:'https://example.com/block'}},
         {type:'expand',attrs:{title:'More detail'},content:[{type:'paragraph',content:[{type:'text',text:'hidden'}]}]}]};
        return Response.json(full);};})()`,
    });
    await page.waitFor(
      `!!document.querySelector('#description a[href="https://example.com/card"]')&&!!document.querySelector('#description a[href="https://example.com/block"]')`,
    );
    const text = await page.eval<string>(`document.getElementById('description').textContent`);
    expect(text).toContain(
      await page.eval<string>(
        `new Date(1767225600000).toLocaleDateString(undefined,{timeZone:'UTC'})`,
      ),
    );
    // BJ-68: an expand is an editable collapsible section now, its title in the section's title field.
    expect(
      await page.eval(`document.querySelector('#description [aria-label="Collapsible section title"]')?.value`),
    ).toBe("More detail");
    expect(text).not.toContain("[expand]");
  });
});

test("a writable site's description: uploads and refused saves", async ({ open }) => {
  await test.step("R1-D10/D18/D100: files upload to Jira at once and in parallel; a failure shows Retry and Discard, not a saved card; leaving mid-upload asks first", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: writable(`if(path.endsWith('/attachments')&&init?.method==='POST'){
        window.__live=(window.__live??0)+1;window.__most=Math.max(window.__most??0,window.__live);
        await new Promise(r=>setTimeout(r,400));window.__live--;
        if(window.__fail!==false)return Response.json({error:'Jira is down'},{status:500});
        const file=init.body.get('file'),id=String(9000+(window.__most++));
        return Response.json({attachment:{id,name:file.name,type:file.type,size:file.size,url:'/api/issues/TEST-2/attachments/'+id,mediaId:'m'+id},collection:'c'});}`),
    });
    await page.waitFor(`!!document.querySelector('#description')`);
    await page.page
      .locator(".rich-editor:has(#description) input[type=file]")
      .setInputFiles(fixtureFiles("media-image.png", "media-file.txt"));
    await page.waitFor(`window.__live===2`);
    expect(
      await page.eval(
        `(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()`,
      ),
    ).toBe(true);
    await page.waitFor(
      `document.querySelector('#description .media-upload[role="alert"]')?.textContent.includes('Jira is down')`,
    );
    expect(await page.eval(`window.__most`)).toBe(2);
    expect(
      await page.eval(`!!document.querySelector('#description img, #description .file-media')`),
    ).toBe(false);
    expect(
      await page.eval(
        `[...document.querySelectorAll('#description .media-upload button')].map(b=>b.textContent)`,
      ),
    ).toEqual(["Retry", "Discard"]);
    expect(await page.eval(`window.__ops`)).toEqual([]);
    await page.eval(`window.__fail=false`);
    await page.click("text=Retry");
    await page.waitFor(
      `document.querySelector('#description .file-media')?.textContent.includes('media-file.txt')`,
    );
    expect(await page.eval(`!!document.querySelector('#description .media-upload')`)).toBe(false);
  });
  await test.step("R1-D9/D27: a description save Jira refuses while typing raises a conflict bar that stays until a version is picked", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: writable(`const hit=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);
        if(hit){const issue=(await (await real('/api/issues')).json()).find(i=>i.key===hit[1]);
         const full=await (await real('/api/issues/'+hit[1])).json();
         full.fields.description={type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'Newer text from Jira'}]}]};
         return Response.json({error:'Someone changed the description in Jira while you were editing it. Pick a version in the description.',key:hit[1],created:{},others:[],issue,full},{status:422});}`),
    });
    await page.waitFor(`!!document.querySelector('#description')`);
    await page.click("#description h2");
    await page.key("End");
    await page.type(" mine");
    await page.waitFor(
      `document.querySelector('[role="alert"]')?.textContent.includes("Someone changed this description in Jira")`,
    );
    // Leaving the editor keeps both the bar and the unsaved text.
    await page.key("Escape");
    await sleep(300); // nothing may drop the text in this window
    expect(await page.eval(`document.getElementById('description').textContent`)).toContain(
      "heading mine",
    );
    await page.click("text=Use Jira's version");
    await page.waitFor(
      `document.getElementById('description')?.textContent.includes('Newer text from Jira')`,
    );
    expect(await page.eval(`document.getElementById('description').textContent`)).not.toContain(
      "mine",
    );
  });
});

test("the board: the first New issue and image shortcuts", async ({ open }) => {
  const page = await open();
  await test.step("R1-D99: the first New issue opens its editor without a loading state", async () => {
    await page.waitFor(`!!document.querySelector('[data-key]')`);
    // Idle time, as a user's first pause, in which the app preloads the editor.
    await page.eval(`new Promise(r=>requestIdleCallback(()=>setTimeout(r,500)))`);
    await page.eval(
      `window.__loading=false;new MutationObserver(()=>{if(document.body.textContent.includes('Loading editor…'))window.__loading=true}).observe(document.body,{subtree:true,childList:true,characterData:true})`,
    );
    await page.key("c");
    await page.waitFor(`!!document.getElementById('create-description')`);
    expect(await page.eval(`window.__loading`)).toBe(false);
    await page.key("Escape");
    await page.waitFor(`!document.getElementById('create-description')`);
  });
  await test.step("R1-D82: F and Space are registered once, not once per image", async () => {
    await fixture.reset({ includeMedia: true, mediaInComment: true });
    const warnings: string[] = [];
    page.page.on("console", (message) => warnings.push(message.text()));
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`document.querySelectorAll('.image-media').length>=2`, 15000);
    await page.click("#description img");
    await page.key(" ");
    await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Preview"]')`);
    expect(warnings.filter((w) => w.includes("already registered"))).toEqual([]);
  });
});
