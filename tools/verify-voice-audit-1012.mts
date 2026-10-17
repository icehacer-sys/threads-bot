// Regressions from the 2026-10-12 voice audit of 1201 real replies (docs/research-2026-10-12/voice-audit).
// Pure functions only: no model calls, no network.
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY='offline-fixture';
process.env.BOT_WEB_SEARCH='off';
process.env.BOT_USAGE_LOG='off';
const {conversationReplyIssue}=await import('../src/supporter-replies');
const {repeatedPhrasing}=await import('../src/reply-variety');
const {crowdGuessNote}=await import('../src/reply-coverage');
const {unsupportedTeachingContrast,unsupportedDeepSeekClaim,isSexualBait}=await import('../src/deepseek-media-policy');

const FACTS='Septic haematogenous lung abscesses. Infection spreads through the bloodstream and seeds many abscesses of different sizes in both lungs. The walls are thick and irregular. The infection is polymicrobial in 90 percent of cases. Cavitating metastases and cavitary pneumonia are listed differentials.';
const ANSWER='Septic haematogenous lung abscesses';

// Fix 1: a joke or lay reading is not opened with a deflating "No X".
const deflating=[
 ['GSW','No gun involved here and the holes in both lungs were seeded through the blood.'],
 ['He got shot','No shooter turned up in this one and these pockets came from infection.'],
 ['Telephone cord?','Nobody swallowed anything and that cord is the oesophagus squeezing on its own.'],
];
for(const [comment,draft] of deflating) assert.match(conversationReplyIssue(comment,'correct',draft,true)??'',/deflating correction/,comment);
// A real medical guess may still be corrected plainly, and honest limits stay allowed.
assert.equal(conversationReplyIssue('TB','correct','Not TB this time and these pockets came through the blood.',true),undefined);
assert.equal(conversationReplyIssue('Did he survive?','teach','No idea how this one ended because the story stops at the film.',true),undefined);
assert.equal(conversationReplyIssue('Telephone cord?','correct','The stretchy kind and your call got routed to diffuse oesophageal spasm.',true),undefined);
assert.equal(conversationReplyIssue('GSW','banter','They really do look like bullet holes but these opened up from the inside.',true),undefined);
// Personal posts keep their own rules.
assert.equal(conversationReplyIssue('He got shot','banter','No way that is the plot twist.',false),undefined);

// Fix 5: grading a bare reaction instead of responding to it.
const grading=[
 ['Wow','Wow is about the right speed for a chest like this.'],
 ['Holy smokes','Holy smokes is about right for this film.'],
 ['WOW','WOW is a fair first word for this one.'],
 ['Dead','That about sums up how the film reads at first glance.'],
];
for(const [comment,draft] of grading) assert.match(conversationReplyIssue(comment,'banter',draft,true)??'',/grading the reaction/,comment);
assert.equal(conversationReplyIssue('Not good','banter','That was my first read too.',true),undefined);
assert.equal(conversationReplyIssue('Is it cancer?','teach','That is a fair worry but these are infection pockets.',true),undefined);
assert.ok(!(conversationReplyIssue('Is that fair to the patient?','teach','That is a fair question and nobody can tell from one film.',true)??'').includes('grading'));

// Fix 2b: a function-word refrain ("through the blood") becomes visible once 5 recent replies share it.
const refrain=(n:number)=>Array.from({length:n},(_,i)=>`Reply ${i} these pockets were seeded through the blood into the lungs number ${i}.`);
const draft='Not TB this time and the abscesses arrived through the blood.';
assert.ok(repeatedPhrasing(draft,refrain(5),[ANSWER,FACTS].join(' '),ANSWER).some(r=>r.includes('through the blood')),'refrain at 5');
assert.ok(!repeatedPhrasing(draft,refrain(4),[ANSWER,FACTS].join(' '),ANSWER).some(r=>r.includes('through the blood')),'no refrain at 4');
// Answer words never count as a refrain: every correct guess shares the diagnosis.
assert.ok(!repeatedPhrasing('Yes septic haematogenous lung abscesses it is.',Array(8).fill('Septic haematogenous lung abscesses is right.'),[ANSWER,FACTS].join(' '),ANSWER).some(r=>r.includes('the refrain "septic haematogenous lung"')));
// Stock reaction shapes.
assert.ok(repeatedPhrasing('Whew is about the right size for a chest that crowded.',['Wow is about the right speed.','Yikes is about right.'],'',ANSWER).some(r=>r.includes('is about the right')));

// Fix 2a: crowd note only when at least 4 earlier comments made the same guess.
// 2026-10-17: the hard-coded Oct 11 alias list is gone. The note now counts repeated guesses per post
// (and the answer's own aliases), so synonyms such as "tuberculosis" no longer fold into "TB".
const tb=['TB','TB again?','Looks like TB','I say TB'];
assert.match(crowdGuessNote('TB?',tb),/^CROWD NOTE: 4 earlier comments on this post also went with TB\./);
assert.equal(crowdGuessNote('TB?',tb.slice(0,3)),'');
assert.match(crowdGuessNote('Gunshot',['gunshot','a gunshot wound','gunshot for sure','shotgun gunshot']),/went with gunshot/);
assert.equal(crowdGuessNote('Beautiful film',tb),'');

// Fix 3: invented teaching contrasts that leaked after #37.
const FACTS_ONLY=[FACTS,ANSWER].join(' ');
assert.equal(unsupportedTeachingContrast('TB usually favours the upper zones while these pockets are scattered.','Tuberculosis',FACTS_ONLY,'correct'),true,'abbreviation of the guess');
assert.equal(unsupportedTeachingContrast('These are spread out rather than one TB cavity at the top.','TB',FACTS_ONLY,'correct'),true,'short guess term and rather than');
assert.equal(unsupportedTeachingContrast('Those cannonballs would land as solid nodules but these are air pockets.','و شاید متاستاز گلوله توپی',FACTS_ONLY,'correct'),true,'non-Latin comment');
assert.equal(unsupportedTeachingContrast('Not TB this time. These are septic abscesses from the blood.','TB',FACTS_ONLY,'correct'),false,'plain correction');
assert.equal(unsupportedTeachingContrast('Yes and the walls are thick and irregular.','Lung abscesses',FACTS_ONLY,'affirm'),false,'supported affirmation');

// Fix 4: organism and distribution claims need the case itself, not the commenter.
const comment='Answer: Bilateral hematogenous lung abscesses (most commonly caused by Staphylococcus aureus).';
assert.equal(unsupportedDeepSeekClaim('That is it and S. Aureus is the organism most often behind it.',[FACTS_ONLY,comment].join(' '),'affirm',FACTS_ONLY),'organism');
assert.equal(unsupportedDeepSeekClaim('These thin-walled pockets are spread evenly through both lungs.',[FACTS_ONLY,'thin-walled evenly'].join(' '),'correct',FACTS_ONLY),'distribution or wall descriptor');
assert.equal(unsupportedDeepSeekClaim('That is the one and the walls are thick and irregular.',FACTS_ONLY,'affirm',FACTS_ONLY),null);
// Without caseSupport the old behaviour is unchanged for non-factsOnly families.
assert.equal(unsupportedDeepSeekClaim('That is the one.',FACTS_ONLY,'affirm'),null);

// Fix 6: sexual bait is skipped before any model call; medical anatomy words alone are not bait.
for(const c of ["Diagnosis: your mom's vagina",'duck blowjob','sounds like phone sex']) assert.equal(isSexualBait(c),true,c);
for(const c of ['Vaginal birth can cause this?','Penile fracture is a thing','Cockroach in the lung?']) assert.equal(isSexualBait(c),false,c);

console.log('voice audit 2026-10-12 regressions passed');
