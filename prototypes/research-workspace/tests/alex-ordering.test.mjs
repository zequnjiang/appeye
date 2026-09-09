import test from 'node:test';
import assert from 'node:assert/strict';
import { sortFields, visibleApps, paginate, canEditResearch, canManageMembers, canOperate, formatNumber } from '../src/utils.js';

const make=(id,extra={})=>({id,title:id,developer:id,country:'th',store:'google-play',externalId:`com.example.${id}`,classification:'confirmed',loanType:'personal',...extra});
const ids=rows=>rows.map(row=>row.id);

test('Alex RP04: nine fields sort their complete values, null always last, numeric zero valid and ties stable in both directions', () => {
  assert.deepEqual(sortFields.map(([field])=>field),['title','developer','firstSeenAt','releasedAt','storeUpdatedAt','lastFetchedAt','score','ratings','minInstalls']);
  for(const field of ['score','ratings','minInstalls']){
    const rows=[make('missing',{[field]:null}),make('z',{[field]:0}),make('c',{[field]:2}),make('b',{[field]:10}),make('a',{[field]:2})];
    assert.deepEqual(ids(visibleApps(rows,{},field,'asc')),['z','a','c','b','missing'],field);
    assert.deepEqual(ids(visibleApps(rows,{},field,'desc')),['b','a','c','z','missing'],field);
  }
  for(const field of ['title','developer']){
    const rows=[make('missing',{[field]:null}),make('z',{[field]:'Beta'}),make('c',{[field]:'Alpha'}),make('b',{[field]:'Gamma'}),make('a',{[field]:'Alpha'})];
    assert.deepEqual(ids(visibleApps(rows,{},field,'asc')),['a','c','z','b','missing'],field);
    assert.deepEqual(ids(visibleApps(rows,{},field,'desc')),['b','z','a','c','missing'],field);
  }
  assert.notEqual(formatNumber(0),'未提供');assert.equal(formatNumber(null),'未提供');
});

test('Alex RP04: chronological sorting compares actual dates across timezone offsets rather than timestamp spelling', () => {
  for(const field of ['firstSeenAt','releasedAt','storeUpdatedAt','lastFetchedAt']){
    const rows=[make('missing',{[field]:null}),make('z',{[field]:'2026-09-08T08:00:00+08:00'}),make('a',{[field]:'2026-09-08T00:00:00Z'}),make('b',{[field]:'2026-09-07T23:30:00Z'}),make('c',{[field]:'2026-09-08T01:00:00+02:00'})];
    assert.deepEqual(ids(visibleApps(rows,{},field,'asc')),['c','b','a','z','missing'],field);
    assert.deepEqual(ids(visibleApps(rows,{},field,'desc')),['a','z','b','c','missing'],field);
  }
});

test('Alex RP04: filtering precedes global sorting and paging with no duplicate/omitted identities or hidden cash-loan rank', () => {
  const rows=Array.from({length:109},(_,index)=>make(`r-${String(index).padStart(3,'0')}`,{title:`Credit ${index}`,score:index%13===0?null:(index*17)%37,country:index%5===0?'mx':'th',store:index%7===0?'app-store':'google-play'}));
  const original=structuredClone(rows), filters={country:'th',store:'google-play',classification:'confirmed',q:'CREDIT'};
  const sorted=visibleApps(rows,filters,'score','asc');
  const independently=rows.filter(row=>row.country==='th'&&row.store==='google-play').sort((a,b)=>a.score===null?(b.score===null?a.id.localeCompare(b.id):1):b.score===null?-1:a.score-b.score||a.id.localeCompare(b.id));
  assert.deepEqual(ids(sorted),ids(independently));
  const pages=paginate(sorted,1,7).pages, gathered=[];
  for(let page=1;page<=pages;page++){
    const result=paginate(sorted,page,7);assert.equal(result.page,page);assert.equal(result.total,sorted.length);gathered.push(...result.rows);
  }
  assert.deepEqual(ids(gathered),ids(independently));assert.equal(new Set(ids(gathered)).size,gathered.length);
  assert.deepEqual(rows,original);
  assert.equal(paginate(sorted,999,7).page,pages);assert.equal(paginate([],999,7).page,1);
  assert.deepEqual(ids(visibleApps([make('cash',{title:'Zulu',loanType:'personal'}),make('business',{title:'Alpha',loanType:'business'})],{},'title','asc')),['business','cash']);
  assert.equal(visibleApps([make('zero',{score:0,minInstalls:0}),make('unknown',{score:null,minInstalls:null})],{score:0,installs:0}).length,1);
});

test('Alex RP08: research write and platform-operation role predicates deny read-only and unknown identities', () => {
  for(const role of ['admin','researcher'])assert.equal(canEditResearch(role),true);
  for(const role of ['viewer','platform','invalid',undefined])assert.equal(canEditResearch(role),false);
  assert.equal(canManageMembers('admin'),true);
  for(const role of ['researcher','viewer','invalid',undefined])assert.equal(canManageMembers(role),false);
  assert.equal(canOperate('platform'),true);
  for(const role of ['admin','researcher','viewer','invalid',undefined])assert.equal(canOperate(role),false);
});
