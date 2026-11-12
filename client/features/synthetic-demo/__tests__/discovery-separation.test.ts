import { createDemoRepository, DEMO_NUMBER, canSavePracticeSuggestionTarget } from '../repository';
function setup() {
 const values=new Map<string,string>(); const storage={getItem:(k:string)=>values.get(k)??null,setItem:jest.fn((k:string,v:string)=>values.set(k,v))};
 const repo=createDemoRepository(storage); const account=repo.login(repo.requestCode(DEMO_NUMBER)).session!;
 const payload=(requestId:string,text='待判断的发现')=>({requestId,input:'虚构输入',text,relation:'create-new' as const});
 const create=(requestId='r1')=>repo.saveDevDiscovery(account,payload(requestId),0).patterns.at(-1)!;
 storage.setItem.mockClear(); return {repo,account,payload,create,storage};
}
const action={ifCue:'看见桌面时',thenAction:'可选地收起一支笔'};
test('saving discovery is unjudged, idempotent and has saved rather than endorsed provenance',()=>{
 const {repo,account,payload,create,storage}=setup(); const s=create();
 expect(s.pattern.decision).toBe('candidate');expect(s.practice).toBeNull();
 expect(s.path[0].source).toContain('用户保存发现');expect(s.path[0].source).not.toContain('用户编辑确认');
 const before=repo.snapshot(); expect(repo.saveDevDiscovery(account,payload('r1'),0)).toEqual(before);expect(storage.setItem).toHaveBeenCalledTimes(1);
 // Reusing a saved request is not an independent endorsement.
 expect(repo.confirmDevUnderstanding(account,payload('r1'),0).patterns[0].pattern.decision).toBe('candidate');
 expect(()=>repo.saveDevDiscovery(account,payload('r1','另一文字'),0)).toThrow();
});
test('legacy explicit confirmation remains available independently',()=>{
 const {repo,account,payload}=setup();expect(repo.confirmDevUnderstanding(account,payload('r2'),0).patterns[0].pattern.decision).toBe('confirmed');
});
test.each(['confirmed','candidate','rejected','uncertain'] as const)('discovery correction preserves negative judgment and drops stale endorsement: %s',decision=>{
 const {repo,account,create}=setup();let s=create();s=repo.updatePattern(account,s.pattern.patternId,{decision},s.pattern.version).patterns[0];
 const next=repo.saveDevDiscovery(account,{input:'修正输入',requestId:'correction',text:'改变后的发现',relation:'correct-current'},s.pattern.version,s.pattern.patternId).patterns[0];
 expect(next.pattern.decision).toBe(decision==='confirmed'?'candidate':decision);
 expect(next.path.at(-1)!.source).toContain('用户保存发现');
 expect(canSavePracticeSuggestionTarget(next.pattern)).toBe(!['rejected','uncertain'].includes(decision));
});
test('saved DEV discovery practice needs separate save/start/record and preserves existing activity on correction',()=>{
 const {repo,account,create}=setup();let s=create();const id=s.pattern.patternId;
 s=repo.savePractice(account,id,action,0).patterns[0]; expect(s.practice!.paused).toBe(true);expect(repo.snapshot().activePracticePatternId).toBeNull();
 expect(()=>repo.saveRecord(account,id,{occurred:false,action:null,feeling:null},s.practice!.version,'before')).toThrow();
 s=repo.activatePractice(account,id,s.practice!.version).patterns[0];
 s=repo.saveRecord(account,id,{occurred:false,action:null,feeling:null},s.practice!.version,'record').patterns[0];
 const oldPractice=s.practice,oldRecords=s.records;
 s=repo.saveDevDiscovery(account,{input:'修正输入',requestId:'correct',text:'修正发现',relation:'correct-current'},s.pattern.version,id).patterns[0];
 expect(s.practice).toEqual(oldPractice);expect(s.records).toEqual(oldRecords);expect(repo.snapshot().activePracticePatternId).toBe(id);
});
test.each(['candidate','uncertain','rejected'] as const)('synthetic and negative targets stay fail-closed: %s',decision=>{
 const {repo,account}=setup();let s=repo.createPattern(account,'合成模式').patterns[0];s=repo.updatePattern(account,s.pattern.patternId,{decision},s.pattern.version).patterns[0];
 expect(canSavePracticeSuggestionTarget(s.pattern)).toBe(false);expect(()=>repo.savePractice(account,s.pattern.patternId,action,0)).toThrow();
});
test.each(['uncertain','rejected'] as const)('negative DEV discovery blocks save, activation, records even after content correction: %s',decision=>{
 const {repo,account,create}=setup();let s=create();const id=s.pattern.patternId;
 s=repo.savePractice(account,id,action,0).patterns[0];s=repo.activatePractice(account,id,s.practice!.version).patterns[0];
 s=repo.updatePattern(account,id,{decision},s.pattern.version).patterns[0];s=repo.saveDevDiscovery(account,{requestId:'c',input:'纠正',text:'新文字',relation:'correct-current'},s.pattern.version,id).patterns[0];
 expect(()=>repo.savePractice(account,id,action,s.practice!.version)).toThrow();expect(()=>repo.activatePractice(account,id,s.practice!.version)).toThrow();expect(()=>repo.saveRecord(account,id,{occurred:false,action:null,feeling:null},s.practice!.version,'record')).toThrow();
});
test('account, version and storage failure remain atomic',()=>{
 const {repo,account,create,storage}=setup();const s=create();const before=repo.snapshot();const p={input:'纠正',requestId:'c',text:'新文字',relation:'correct-current' as const};
 expect(()=>repo.saveDevDiscovery('other',p,s.pattern.version,s.pattern.patternId)).toThrow();expect(()=>repo.saveDevDiscovery(account,p,s.pattern.version+1,s.pattern.patternId)).toThrow();
 storage.setItem.mockImplementationOnce(()=>{throw Error('blocked')});expect(()=>repo.saveDevDiscovery(account,p,s.pattern.version,s.pattern.patternId)).toThrow();expect(repo.snapshot()).toEqual(before);
});
test('candidate target requires verified local DEV origin, not merely candidate status',()=>{
 const {create}=setup();const p=create().pattern;
 expect(canSavePracticeSuggestionTarget({...p,origin:undefined})).toBe(false);
 expect(canSavePracticeSuggestionTarget({...p,demoSource:'synthetic'})).toBe(false);
 expect(canSavePracticeSuggestionTarget({...p,origin:{input:'虚构输入',requestId:'invalid/request'}})).toBe(false);
});
test.each(['confirmed','candidate','rejected','uncertain'] as const)('mode editor text-only repository change does not endorse: %s',decision=>{
 const {repo,account,create}=setup();let s=create();const id=s.pattern.patternId;
 s=repo.updatePattern(account,id,{decision},s.pattern.version).patterns[0];
 s=repo.updatePattern(account,id,{currentUnderstanding:'新的实质内容'},s.pattern.version).patterns[0];
 expect(s.pattern.decision).toBe(decision==='confirmed'?'candidate':decision);
});
test('name-only, unchanged and boundary-whitespace edits keep old judgment; explicit judgment applies to new text',()=>{
 const {repo,account,create}=setup();let s=create();const id=s.pattern.patternId;
 s=repo.updatePattern(account,id,{decision:'confirmed'},s.pattern.version).patterns[0];
 for(const patch of [{name:'新名字'},{currentUnderstanding:s.pattern.currentUnderstanding},{currentUnderstanding:' '+s.pattern.currentUnderstanding+' '}]) {
  s=repo.updatePattern(account,id,patch,s.pattern.version).patterns[0];expect(s.pattern.decision).toBe('confirmed');
 }
 s=repo.updatePattern(account,id,{currentUnderstanding:'用户明确认可的新文字',decision:'confirmed'},s.pattern.version).patterns[0];expect(s.pattern.decision).toBe('confirmed');
});
