import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtures, createPendingDemo, DEMO_DAY} from '../src/data.js';
import {latestMarketObservation} from '../src/utils.js';

test('Alex RP02: latest market observation follows filtered source identity, not static copy, excluded apps or another market/date', () => {
  const f=createFixtures(), sample=f.apps.find(a=>a.id==='th-1');
  const apps=[...f.apps,{...sample,id:'excluded-new',classification:'excluded'},
    {...sample,id:'other-kind',loanType:'business',title:'BUSINESS-LATEST'},
    {...sample,id:'accepted-new',title:'SOURCE-TITLE'}];
  const event=(id,appId,time,extra={})=>({id,appId,country:'th',date:DEMO_DAY,type:'updated',at:time,observedAt:time,...extra});
  const events=[...f.events,
    event('excluded-event','excluded-new','2026-09-08T13:00:00+08:00'),
    event('business-event','other-kind','2026-09-08T12:30:00+08:00'),
    event('accepted-event','accepted-new','2026-09-08T04:00:00Z',{title:'UNTRUSTED-EVENT-TITLE'}),
    event('future-event','accepted-new','2026-09-09T12:00:00+08:00',{date:'2026-09-09'}),
    event('other-country-event','accepted-new','2026-09-08T14:00:00+08:00',{country:'ar'})];
  const selected=latestMarketObservation(apps,events,{country:'th',day:DEMO_DAY});
  assert.equal(selected.id,'accepted-event');assert.equal(selected.title,'SOURCE-TITLE');
  assert.equal(selected.observedTime,'2026-09-08T04:00:00Z');
  assert.equal(latestMarketObservation(apps,events,{country:'th',day:DEMO_DAY,cashOnly:false}).id,'business-event');
  assert.equal(latestMarketObservation(apps,events,{country:'th',day:'2026-09-10'}),null);
  assert.equal(latestMarketObservation(apps,events,{country:'xx',day:DEMO_DAY}),null);
  const sameTime=[...events,event('equal-time-event','accepted-new','2026-09-08T12:00:00+08:00')];
  assert.deepEqual(latestMarketObservation(apps,sameTime,{country:'th',day:DEMO_DAY}),
    latestMarketObservation([...apps].reverse(),[...sameTime].reverse(),{country:'th',day:DEMO_DAY}));
});

test('Alex RP02/04: a pending observation does not mutate displayed sources, and history/explicitly applied input have their own latest evidence', () => {
  const {apps,events}=createFixtures(),query={country:'th',day:DEMO_DAY};
  const before=latestMarketObservation(apps,events,query),pending=createPendingDemo(apps,events);
  assert.deepEqual(latestMarketObservation(apps,events,query),before);
  const applied=latestMarketObservation(pending.apps,pending.events,query);
  assert.equal(applied.appId,'th-new-demo');assert.equal(applied.type,'firstSeen');
  assert.equal(applied.title,pending.apps.find(a=>a.id==='th-new-demo').title);
  assert.equal(applied.source,pending.apps.find(a=>a.id==='th-new-demo').source);
  const historical=latestMarketObservation(pending.apps,pending.events,{country:'th',day:'2026-09-07'});
  assert.equal(historical.id,'th-19-historical-update');
  assert.equal(historical.observedTime,'2026-09-07T09:20:00+08:00');
  assert.equal(latestMarketObservation(pending.apps,pending.events,{country:'ar',day:'2026-09-07'}),null);
});
