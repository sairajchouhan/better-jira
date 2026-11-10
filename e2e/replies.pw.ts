import { expect, test, fixture } from "./app";

// A writable site, faked in the page: comment ops are recorded and accepted unchanged.
const setup = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 return Response.json({key:m[1],created:{},others:[],issue});
};})()`;

test("a reply to a Jira reply joins its thread under the root and mentions who it answers", async ({
  open,
}) => {
  await fixture.reset({ threadedComments: true });
  const p = await open("?issue=TEST-2&view=page", { setup });
  try {
    // Jira's own reply (numeric parentId) shows inside the thread, mention and all.
    await p.waitFor(`!!document.querySelector('[data-thread="10100"] [data-comment="10101"]')`);
    expect(await p.eval(`document.querySelectorAll('[data-thread]').length`)).toBe(1);
    expect(await p.eval(`document.querySelector('[data-comment="10101"]').textContent`)).toContain(
      "@Alex Reply made in Jira",
    );

    // Replying to the root opens the thread composer with no mention.
    await p.hover('[data-comment="10100"]');
    await p.click('[data-comment="10100"] [aria-label="Reply to comment"]');
    await p.waitFor(`!!document.activeElement?.closest('[data-thread="10100"] .rich-editor')`);
    expect(
      await p.eval(`document.querySelector('[data-thread="10100"] .rich-editor').textContent`),
    ).not.toContain("@");

    // Replying to the reply keeps the composer and starts it with @Jordan, caret after it.
    await p.hover('[data-comment="10101"]');
    await p.click('[data-comment="10101"] [aria-label="Reply to comment"]');
    await p.waitFor(
      `document.activeElement?.closest('[data-thread="10100"] .rich-editor')?.textContent.includes('@Jordan')`,
    );
    await p.type("Answering Jordan");
    await p.key("Enter", "meta");
    await p.waitFor(`window.__ops.length===1`);
    const op = await p.eval(`window.__ops[0][0]`);
    expect(op).toMatchObject({ op: "comment", parentId: "10100" });
    expect(op.body.content).toMatchObject([
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { id: "jordan", text: "@Jordan" } },
          { type: "text", text: " Answering Jordan" },
        ],
      },
    ]);
    // Same thread, one level: Linear's look, Jira's model.
    await p.waitFor(`document.querySelectorAll('[data-thread="10100"] [data-comment]').length===3`);
    expect(await p.eval(`document.querySelectorAll('[data-thread]').length`)).toBe(1);
    expect(
      await p.eval(
        `[...document.querySelectorAll('[data-thread="10100"] .comment-reply')].at(-1).textContent`,
      ),
    ).toContain("@Jordan Answering Jordan");
  } finally {
    await p.close();
  }
});
