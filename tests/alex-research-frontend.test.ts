import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { alexApp, alexBrowserHarness } from './alex-browser-fixture.js';

let harness: Awaited<ReturnType<typeof alexBrowserHarness>>;
before(async () => { harness = await alexBrowserHarness(); });
after(async () => { await harness?.close(); });
const principal = (workspaceId:number) => ({ authenticated:true, configured:true, dataset:'demo', user:{id:11,name:'Alex member',email:'alex@fixture.test',role:'admin',workspaceId}, workspaces:[{id:1,name:'Alex Alpha'},{id:2,name:'Alex Beta'}], authorizationVersion:`alex-space-${workspaceId}` });
const research = (id:number) => ({workspace:{id,name:id===1?'Alex Alpha':'Alex Beta'},groups:[],favorites:[],collections:[],readStates:[],requests:[],apps:[],entries:[{id:10+id,appId:1,appIdentity:{id:1,title:'Previously researched app',country:'ar',store:'google-play',externalId:'alex.fixture.1'},appVisible:false,collectionId:null,kind:'note',text:id===1?'Alpha private saved research':'Beta private saved research',citation:null,createdBy:11,revision:1,createdAt:'2026-09-07T01:00:00Z',updatedAt:'2026-09-07T01:00:00Z'}]});

test('Alex RWP event detail 404 removes event plaintext and new write actions while preserving separately saved own research', async () => {
 const {context,page,state}=await harness.fixture(1280,{clock:true});
 try {
  let denied=false;
  const event={id:'observedUpdate:1:99',appId:1,country:'ar',store:'google-play',externalId:'alex.fixture.1',title:'Alex revoked source app',type:'observedUpdate',eventAt:'2026-09-09T01:00:00Z',observedAt:'2026-09-09T01:00:00Z',snapshotId:99,sourceUrl:'https://example.test/event-source',changes:[{id:100,field:'description',oldValue:'Alex old public source plaintext',newValue:'Alex newer public source plaintext'}],releaseNotes:'Alex private-to-be event release notes',versionChanged:false,releasedAt:null};
  await page.route('**/api/auth/session',route=>route.fulfill({json:principal(1)}));
  await page.route('**/api/research/state',route=>route.fulfill({json:research(1)}));
  await page.route('**/api/market/activity?**',route=>route.fulfill({json:{date:'2026-09-09',counts:{firstSeen:0,storeRelease:0,observedUpdate:1},eventCounts:{firstSeen:0,storeRelease:0,observedUpdate:1},countries:[],events:[event],featuredEvents:[event],total:1,uniqueApps:1}}));
  await page.route('**/api/apps/1',route=>route.fulfill(denied?{status:404,json:{error:'Alex public visibility removed'}}:{json:{app:{...alexApp(1),title:event.title},snapshots:[],changes:[],reviews:[],enrichments:[],rawDetail:{original:true}}}));
  await page.reload();await page.getByRole('heading',{name:'今日市场',exact:true}).waitFor();
  await page.getByRole('button',{name:event.title,exact:true}).click();
  await page.getByText('Alex old public source plaintext',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'写备注',exact:true}).count(),1);
  denied=true;
  await page.getByRole('button',{name:'刷新当前数据',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Alex public visibility removed'}).first().waitFor();
  await expect(page.locator('.selected-event')).toHaveCount(0);
  for(const text of ['Alex old public source plaintext','Alex newer public source plaintext','Alex private-to-be event release notes']) assert.equal(await page.getByText(text,{exact:true}).count(),0,text);
  for(const name of ['关注应用','写备注','保存摘录','加入集合']) assert.equal(await page.getByRole('button',{name,exact:true}).count(),0,name);
  await page.getByRole('navigation').getByRole('button',{name:'研究空间',exact:true}).click();
  await page.getByText('Alpha private saved research',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'查看应用',exact:true}).count(),0);
  assert.deepEqual(state.pageErrors,[]);
 } finally {await context.close();}
});

test('Alex RWP a delayed old session poll cannot undo explicit workspace switch or restore private research and pending data', async () => {
 const {context,page,state}=await harness.fixture(1280,{clock:true});
 let release:(()=>void)|undefined;
 try {
  let workspaceId=1,hold=false,waiting=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/auth/session',async route=>{
   const captured=principal(workspaceId);
   if(hold){waiting=true;await gate;}
   await route.fulfill({json:captured}).catch(()=>{});
  });
  await page.route('**/api/auth/workspace',async route=>{
   assert.equal(route.request().postDataJSON().workspaceId,2);
   workspaceId=2;state.rows[0].title='Beta current public row';await route.fulfill({json:principal(2)});
  });
  await page.route('**/api/research/state',route=>route.fulfill({json:research(workspaceId)}));
  await page.reload();await page.getByRole('heading',{name:'今日市场',exact:true}).waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'应用库',exact:true}).click();
  await page.locator('[data-library-row]').first().waitFor();
  state.rows[0].title='Alpha pending public row';
  await page.clock.fastForward(15000);
  await page.getByRole('button',{name:'更新清单',exact:true}).waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'研究空间',exact:true}).click();
  await page.getByText('Alpha private saved research',{exact:true}).waitFor();
  hold=true;await page.clock.fastForward(15000);await expect.poll(()=>waiting).toBe(true);
  await page.getByLabel('切换客户空间').selectOption('2');
  await expect(page.getByLabel('切换客户空间')).toHaveValue('2');
  assert.equal(await page.getByText('Alpha private saved research',{exact:true}).count(),0);
  hold=false;release();await page.waitForTimeout(100);
  assert.equal(await page.getByLabel('切换客户空间').inputValue(),'2');
  await page.getByRole('navigation').getByRole('button',{name:'研究空间',exact:true}).click();
  await page.getByText('Beta private saved research',{exact:true}).waitFor();
  assert.equal(await page.getByText('Alpha private saved research',{exact:true}).count(),0);
  await page.getByRole('navigation').getByRole('button',{name:'应用库',exact:true}).click();
  await page.getByText('Beta current public row',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'更新清单',exact:true}).count(),0);
  assert.equal(await page.getByText('Alpha pending public row',{exact:true}).count(),0);
  assert.deepEqual(state.pageErrors,[]);
 } finally {release?.();await context.close();}
});
