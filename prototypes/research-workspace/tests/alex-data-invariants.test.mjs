import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtures, createPendingDemo, admitCandidate, DEMO_DAY } from '../src/data.js';
import { marketCounts, exportResearch } from '../src/utils.js';

const expected = { th:[8,5,18], mx:[6,4,12], ph:[5,3,10], pk:[4,2,7], id:[3,6,9], ar:[4,3,8] };
const identity = app => `${app.country}/${app.store}/${app.externalId}`;

test('Alex RP02: reset fixtures enumerate 132 confirmed market records, 120 cash loans, 12 separate candidates and fixed country/store identities', () => {
  const fixture=createFixtures();
  assert.equal(DEMO_DAY,'2026-09-08');
  assert.equal(fixture.apps.length,132);
  assert.equal(new Set(fixture.apps.map(identity)).size,132);
  assert.ok(fixture.apps.every(app=>app.classification==='confirmed'));
  assert.equal(fixture.apps.filter(app=>app.loanType==='personal').length,120);
  assert.equal(fixture.candidates.length,12);
  for(const country of Object.keys(expected)){
    const apps=fixture.apps.filter(app=>app.country===country);
    assert.equal(apps.length,22);
    for(const store of ['google-play','app-store'])assert.equal(apps.filter(app=>app.store===store).length,11);
    assert.equal(fixture.candidates.filter(app=>app.country===country).length,2);
  }
  assert.ok(fixture.apps.some(app=>app.classificationSource==='manual'));
  assert.ok(fixture.apps.some(app=>app.classificationSource==='auto'));
  assert.ok(fixture.apps.filter(app=>app.store==='app-store').every(app=>app.minInstalls===null));
  fixture.apps[0].title='Changed local example';
  fixture.workspaces.north.notes[0].text='Changed private example';
  const reset=createFixtures();
  assert.notEqual(reset.apps[0].title,fixture.apps[0].title);
  assert.notEqual(reset.workspaces.north.notes[0].text,fixture.workspaces.north.notes[0].text);
});

test('Alex RP02/03: all 117 current-day events, four featured references and country totals derive from the same identities and source observations', () => {
  const {apps,events,featuredIds}=createFixtures();
  const today=events.filter(event=>event.date===DEMO_DAY);
  assert.equal(today.length,117);
  assert.equal(new Set(events.map(event=>event.id)).size,events.length);
  assert.equal(featuredIds.length,4); assert.equal(new Set(featuredIds).size,4);
  const index=new Map(apps.map(app=>[app.id,app]));
  for(const event of events){
    const app=index.get(event.appId);assert.ok(app,`missing app for ${event.id}`);
    assert.equal(event.country,app.country);assert.equal(event.store,app.store);
    assert.ok(event.source);assert.ok(event.observedAt);
  }
  assert.ok(featuredIds.every(id=>today.some(event=>event.id===id)));
  const actual=marketCounts(apps,events,{day:DEMO_DAY});
  for(const [country,counts] of Object.entries(expected))assert.deepEqual(actual[country],{firstSeen:counts[0],storeRelease:counts[1],updated:counts[2]});
  assert.equal(today.filter(event=>event.type==='firstSeen').length,30);
  assert.equal(today.filter(event=>event.type==='storeRelease').length,23);
  assert.equal(new Set(today.filter(event=>event.type==='updated').map(event=>event.appId)).size,64);
  assert.ok(new Set(today.map(event=>event.appId)).size<117,'overlapping event categories are not distinct app counts');
  assert.deepEqual(marketCounts(apps,events,{day:'2026-09-10'}),{});
});

test('Alex RP02: unique-app counts deduplicate repeated observations and honor day and classification scope', () => {
  const {apps,events}=createFixtures(), sample=events.find(event=>event.type==='updated');
  const repeated=[...events,{...sample,id:'independent-duplicate-observation'}];
  assert.deepEqual(marketCounts(apps,repeated),marketCounts(apps,events));
  const removed=apps.map(app=>app.id===sample.appId?{...app,classification:'excluded'}:app);
  const before=marketCounts(apps,events), after=marketCounts(removed,events);
  assert.equal(after[sample.country].updated,before[sample.country].updated-1);
  const elsewhere={...sample,id:'historic-copy',date:'2026-09-07'};
  assert.deepEqual(marketCounts(apps,[...events,elsewhere]),before);
});

test('Alex RP04/05: a simulated update preserves the displayed source fixture and keeps new record/event source identity coherent', () => {
  const {apps,events}=createFixtures(), previous=structuredClone({apps,events});
  const pending=createPendingDemo(apps,events);
  assert.deepEqual({apps,events},previous);
  assert.equal(pending.apps.length,apps.length+1);
  assert.equal(new Set(pending.apps.map(identity)).size,pending.apps.length);
  const inserted=pending.apps.find(app=>!apps.some(old=>old.id===app.id));
  const event=pending.events.find(event=>event.appId===inserted.id);
  assert.ok(event);assert.equal(event.country,inserted.country);assert.equal(event.store,inserted.store);
  assert.equal(new URL(inserted.source).searchParams.get('id'),inserted.externalId);
  assert.equal(event.source,inserted.source);
  assert.equal(marketCounts(pending.apps,pending.events).th.firstSeen,expected.th[0]+1);
});

test('Alex RP07: independently supplied customer research exports keep same-app private notes and collection membership isolated', () => {
  const {apps}=createFixtures();
  const space=(name,text)=>({name,collections:[{id:`${name}-c`,name:`${name} collection`,appIds:[apps[0].id]}],notes:[{id:`${name}-n`,appId:apps[0].id,text,author:`${name} author`,date:DEMO_DAY}]});
  const a=exportResearch(space('North','PRIVATE-NORTH-MARKER'),apps), b=exportResearch(space('South','PRIVATE-SOUTH-MARKER'),apps);
  assert.match(a,/PRIVATE-NORTH-MARKER/);assert.doesNotMatch(a,/PRIVATE-SOUTH-MARKER/);
  assert.match(b,/PRIVATE-SOUTH-MARKER/);assert.doesNotMatch(b,/PRIVATE-NORTH-MARKER/);
  assert.match(a,/示例/);assert.match(b,/示例/);
});

test('Alex RP04: repeated mock-update requests keep a single identity and event rather than duplicating the pending or applied app', () => {
  const {apps,events}=createFixtures();
  const first=createPendingDemo(apps,events);
  const independent=createPendingDemo(apps,events);
  assert.deepEqual(first,independent,'two detections against the same displayed snapshot are deterministic');
  const second=createPendingDemo(first.apps,first.events);
  assert.equal(new Set(second.apps.map(identity)).size,second.apps.length,'repeating after apply must not duplicate a market identity');
  assert.equal(new Set(second.apps.map(app=>app.id)).size,second.apps.length);
  assert.equal(new Set(second.events.map(event=>event.id)).size,second.events.length);
  assert.equal(second.apps.length,first.apps.length);
  assert.equal(marketCounts(second.apps,second.events).th.firstSeen,marketCounts(first.apps,first.events).th.firstSeen);
});

test('Alex RP02/05: all market sources and event timestamps refer to their own record, retaining date-only releases and non-version changes', () => {
  const {apps,events}=createFixtures();
  for(const app of apps){
    const url=new URL(app.source);
    if(app.store==='google-play'){
      assert.equal(url.hostname,'play.google.com');assert.equal(url.searchParams.get('id'),app.externalId);
    }else{
      assert.equal(url.hostname,'apps.apple.com');assert.equal(decodeURIComponent(url.pathname),`/${app.country}/app/id${app.externalId}`);
    }
    assert.ok(Date.parse(app.firstSeenAt)<=Date.parse(app.lastFetchedAt),app.id);
    if(app.storeUpdatedAt)assert.ok(Date.parse(app.storeUpdatedAt)<=Date.parse(app.lastFetchedAt),app.id);
    assert.match(app.description,new RegExp(app.loanType==='personal'?'个人现金贷款':app.loanType==='business'?'经营贷款':'住房抵押贷款'));
  }
  for(const event of events){
    const app=apps.find(app=>app.id===event.appId);
    assert.equal(event.source,app.source);
    assert.equal(Date.parse(event.at),Date.parse(event.observedAt),event.id);
    assert.ok(Date.parse(event.observedAt)<=Date.parse(app.lastFetchedAt),event.id);
    if(event.type==='firstSeen')assert.equal(Date.parse(event.at),Date.parse(app.firstSeenAt),event.id);
    if(event.type==='storeRelease'){
      assert.equal(event.releasePrecision,'date');assert.equal(event.releasedAt,app.releasedAt);
      assert.equal(event.releasedAt.length,10);
    }
    if(event.field==='seller')assert.equal(event.after,app.seller);
  }
  assert.ok(events.some(event=>event.date<DEMO_DAY));
  assert.ok(events.some(event=>event.field==='loanTerm'));
  assert.ok(events.some(event=>event.field==='seller'));
});

test('Alex RP09: all twelve admissions stay market-specific, leave old records/research untouched, and preserve a known manual identity', () => {
  const original=createFixtures(), frozen=structuredClone(original);
  let admitted=original;
  for(const candidate of original.candidates)admitted=admitCandidate(admitted,candidate.id);
  assert.equal(admitted.apps.length,144);assert.equal(new Set(admitted.apps.map(identity)).size,144);
  assert.deepEqual(original,frozen);assert.deepEqual(admitted.apps.slice(0,132),original.apps);
  assert.deepEqual(admitted.workspaces,original.workspaces);
  for(const candidate of admitted.candidates){
    assert.equal(candidate.status,'approved');
    const app=admitted.apps.find(app=>app.id===candidate.appId);
    assert.equal(identity(app),identity(candidate));assert.equal(app.classificationSource,'manual');
    assert.equal(app.releasedAt,null);assert.equal(app.firstSeenAt,app.lastFetchedAt);
    assert.equal(admitted.events.find(event=>event.appId===app.id).source,app.source);
    if(app.store==='app-store'){
      assert.equal(app.minInstalls,null);assert.equal(app.permissionStatus,'unsupported');
      assert.equal(decodeURIComponent(new URL(app.source).pathname),`/${app.country}/app/id${app.externalId}`);
    }else assert.equal(new URL(app.source).searchParams.get('id'),app.externalId);
  }
  const existing={...original.apps[0],classificationSource:'manual',classification:'excluded'};
  const overlapping={id:'same-market-new-source',country:existing.country,store:existing.store,externalId:existing.externalId,status:'pending'};
  const input={...original,apps:original.apps.map(app=>app.id===existing.id?existing:app),candidates:[overlapping]};
  const result=admitCandidate(input,overlapping.id);
  assert.equal(result.apps.length,132);assert.deepEqual(result.apps,input.apps);
  assert.deepEqual(result.events,input.events);assert.equal(result.candidates[0].appId,existing.id);
  assert.equal(admitCandidate(result,overlapping.id),result);
});
