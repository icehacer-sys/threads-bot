# Daily 30-second step: add the answer

When you post a new X-ray challenge, add one entry to `data/answers.json`. That lets the bot:

- affirm correct guesses ("Spot on ✅"),
- nudge wrong guesses with **your** facts (not invented ones),
- auto-post the answer after 1 hour, with the diagnosis blurred as a spoiler.

## How (no PC needed)

1. Copy your post's **shortcode** — the code at the end of its URL:
   `threads.com/@mdnoteslab/post/` **`DZaiXl2iWzZ`**
2. On GitHub, open `data/answers.json` and click the pencil ✏️ to edit. Add this block at the top, filling in your case:

```json
"PASTE_SHORTCODE_HERE": {
  "answer": "Diagnosis Name",
  "aliases": ["common synonym", "another way people phrase it"],
  "facts": [
    "One vetted distinguishing fact, in your own words.",
    "What it is / why it matters, in one line.",
    "Management in one line."
  ],
  "breakdown": "Answer: Diagnosis Name\n👀 What you see:\n...\n🫀 Why it matters:\n...\n💊 Treatment:\n...\n📝 Takeaway:\n..."
},
```

3. Commit. Done — the next run picks it up.

## Notes

- Start `breakdown` with `Answer: <diagnosis>`. The bot blurs everything after `Answer:`, so only that label shows until someone taps.
- Inside `breakdown`, use `\n` for line breaks (it's one line in the file). Pick the section emoji that fits the case (🫀 heart, 🦴 bone, 🧠 brain, etc).
- `facts` are what keep corrections accurate — always your words, never the model's guess.
- Skip the entry and the bot still banters; it just won't affirm, correct with facts, or auto-post the answer for that post.
