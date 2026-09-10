# Medical and image concern replies

Owner-approved behavior, 2026-09-10.

- Personal experiences without an advice request remain eligible for natural empathy.
- Explicit requests for personal medical advice receive approved boundary wording. Mentioning illness, hospitals or advice received in the past does not qualify. A personal_medical classification without an explicit request gets one recheck for story/empathy/banter; persistent ambiguity is skipped. The model cannot write diagnosis or treatment advice into the boundary response.
- The retired response beginning "That sounds worrying" is blocked in fresh drafts and saved publication recovery. Deleted replies are not automatically reposted.
- Requests to send personal scans receive a fixed decline. No scans, private details or DMs are requested.
- Explicit immediate-danger wording has a short emergency-services boundary. This is not a comprehensive emergency-triage system.
- Specific anatomy concerns receive at most one neutral acknowledgment. Provenance questions and hostile image accusations receive no automatic answer.
- Concern responses have no jokes, sales links, GIFs or promises to review.
- One acknowledgment is allowed per commenter, post and concern group. The existing exact-duplicate check can also suppress a stock line already posted under that case.

Visible anatomy concerns are recorded before candidate ranking. While any anatomy concern for that post is unresolved, the reply bot withholds case facts and pauses diagnosis affirmations, corrections, teaching and reference replies. Unrelated banter and empathy remain eligible. This hold affects the reply bot; it does not cancel the separate publisher's scheduled answer or CTA.

View pending reviews with `npm run reviews`. Each new entry includes the post ID, comment ID, username, comment text, reason and time. Historical entries may lack comment text. No public promise or notification is sent automatically.

After checking the concern and making any necessary correction, resolve it with:

```powershell
npm run reviews -- --resolve=COMMENT_ID --note="Checked and corrected the affected finding"
```

Sync from main before editing review state, then commit and push the resulting state change so the cloud worker sees it. Every unresolved anatomy concern for the post must be resolved before image-dependent replies resume. A resolved comment stays in the audit history and does not reopen the hold on the next poll.

Verification: `npm run concerns:verify` uses mocked model responses and temporary state. It makes no paid API calls or public replies. The broader publishing, audit and voice checks still apply.
