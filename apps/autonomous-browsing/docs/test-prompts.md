# Test prompts: two compliance research scenarios

Two real workflows, written as prompts this app can actually run today:

1. **Publicity check** — is an expert's statement already public knowledge?
2. **Re-identification check** — can an expert be named from the generic claims
   they made about themselves and their employer?

Each scenario runs as a ladder: a smoke test, then one source, then the full
multi-source workflow, then a negative control. Run them in order, because a
failure at rung 3 is only diagnostic if rungs 1 and 2 passed.

---

## Before you start: five constraints these prompts are written around

Read this section once. Every prompt below is shaped by it, and a prompt that
ignores it fails for reasons that have nothing to do with the research.

1. **A goal run cannot return data.** `runChatGoal` returns `void`. The only
   things a goal run leaves behind are the step descriptions in the run thread,
   the per-step screenshots, and its recorded steps. There is no `extracted`
   bag. So every prompt below tells the model to **write its finding into the
   step description** — that string is pushed into the history the next model
   call reads, so findings do carry forward across steps, and they are what you
   read back afterwards in the thread. If you need the actual page text out of
   the app, use a routine with an `extract` step (§3 below).

2. **The model reads clipped text.** `filterDom` truncates every text node to
   200 characters. The model can tell you whether an article is about a $200
   MacBook price rise; it often cannot quote the sentence exactly. Don't test
   for verbatim quotation on a goal run — test for it via `extract`, which
   returns up to 10 000 characters of real `innerText`.

3. **A goal run has three verbs: `click`, `type`, `navigate`.** No `scroll`, no
   `extract`, no `select` — the `action` enum in `DECIDE_NEXT_ACTION_TOOL`
   allows nothing else. So never write "scroll down and read the rest": say
   "open the article" or "navigate to the print/amp version".

4. **Budgets.** 40 steps per goal run, 6 consecutive failures, and 8 identical
   consecutive frames ends the run as *going in circles*. Budget roughly 4–6
   steps per source, so **three or four sources is the honest ceiling for one
   goal run**. A five-site sweep should be five runs, not one prompt.

5. **The tab must stay in front.** `capture()` throws unless the target tab is
   the active tab in its window, so switching tabs mid-run costs you every
   screenshot and every DOM snapshot from that point. Start the run and leave
   the window alone.

Two guards will fire during these scenarios, and both are the app working:

- **A visible password, payment, one-time-code field or CAPTCHA iframe holds
  the whole page** (`scanSensitive`). The run parks, you act in the browser, you
  press Resume. That run then reports **`assisted`**, never `done` — expected,
  not a bug.
- **Typing into a password field is refused outright** (`assertWritableTarget`),
  and that refusal is never healed. §2 rung E tests exactly this.

Also worth knowing before scenario 2: `COMMIT_WORDS` covers *send* and
*submit*, so clicking **Send** on a LinkedIn invite goes to a human rather than
the healer. It does **not** cover *connect* — a bare **Connect** button is an
ordinary click and will just be pressed. Say so in the prompt.

---

## 1. Scenario one — is the statement public?

The claim under test throughout: *"Apple is raising their prices on MacBooks by
$200 next month."*

### A — Smoke test: one search, one open, one verdict

Paste into the goal box:

```
Go to google.com and search for: MacBook price increase $200

Open the single most relevant result. Read the page. Then finish with done.

In the description of every step, prefix your finding like this:
FINDING=<yes|no|unclear> WHY=<the headline or phrase that decided it>

Your final done description must say, in one sentence, whether this page shows
that Apple is raising MacBook prices by $200 next month.
```

Passes if: the run ends `done` or `assisted` in under 10 steps, and the thread
contains at least one `FINDING=` line. This rung is testing the app, not the
research — a `FINDING=no` is a pass.

### B — A paywalled source, using your own logged-in session

```
Go to wsj.com. Use the site's own search to search for: MacBook prices

Open the most recent article that looks like it is about Apple raising MacBook
prices. Read it.

If a subscribe wall, paywall or consent dialog covers the article and you cannot
read the text, do not try to get around it: finish with done and say the article
was not readable and why.

In each step description, prefix your finding with:
FINDING=<yes|no|unclear> SOURCE=wsj.com WHY=<headline or phrase>
```

This is the interesting rung, and it has three distinct outcomes, all of which
are informative:

- **The article reads** — your Chrome profile carried the subscription, which is
  the whole premise of the product.
- **A subscribe modal covers the target** and the click times out. That is
  `waitForActionable` refusing to click through an overlay, and it is correct
  behaviour: a covered match is scrolled at and re-tested, and something that
  survives the scroll is a real refusal.
- **A visible CAPTCHA iframe parks the run.** Solve it in the browser, press
  Resume, and expect the run to finish `assisted`.

Repeat with `ft.com`, `bloomberg.com` and `theinformation.com` as separate runs.

### C — The real workflow: three sources in one run

```
I need to know whether this claim is already public knowledge:
"Apple is raising their prices on MacBooks by $200 next month."

Check three sources, in this order, one at a time. Use each site's own search
box, and spend no more than six steps on any one site — if a site's search does
not work, move on to the next site by navigating straight to it.

1. news.google.com — search: Apple MacBook price increase
2. reuters.com — search: Apple MacBook price
3. wsj.com — search: MacBook prices

After each site, carry your finding forward by prefixing the next step's
description with:
SOURCE=<site> FOUND=<yes|no> DETAIL=<headline and date, or nothing>

Finish with done, and in that final description give one of exactly three
verdicts: PUBLIC, PARTIALLY REPORTED, or NOT PUBLIC.
```

Passes if: three `SOURCE=` lines appear in the thread and the run ends with a
verdict rather than hitting the 40-step cap. Note what it costs — one model call
per step, so this run is roughly 12–20 calls.

### D — Negative control: a claim that is definitely not public

Same as rung C, but with a claim you invented:

```
I need to know whether this claim is already public knowledge:
"Dell is cutting XPS 14 prices by $317 starting September 12th."

Check three sources, in this order, one at a time. Use each site's own search
box, and spend no more than six steps on any one site.

1. news.google.com — search: Dell XPS price cut
2. reuters.com — search: Dell XPS pricing
3. theverge.com — search: Dell XPS price

After each site, prefix the next step's description with:
SOURCE=<site> FOUND=<yes|no> DETAIL=<headline and date, or nothing>

Finish with done and one verdict: PUBLIC, PARTIALLY REPORTED, or NOT PUBLIC.
Do not treat a story about Dell discounts in general as a match for this
specific claim.
```

Passes only if the verdict is NOT PUBLIC. This rung is the one that tells you
whether the tool can be trusted for the actual job: a publicity check that
answers PUBLIC to an invented number is worse than no check at all.

---

## 2. Scenario two — can the expert be identified?

The disclosed details throughout: *works at a mid-sized grocery chain in the
Western US*, *previously worked at Walmart*, *is a category manager for frozen
foods*.

### A — Public web only, no login

```
Three details were disclosed about one person:
- they work at a mid-sized grocery chain in the Western United States
- they previously worked at Walmart
- they are a category manager for frozen foods

Find out whether those three details identify a specific person. Search
google.com only, and do not sign in to anything.

Try these searches, one per step, using google.com's search box:
1. "category manager" frozen "grocery" linkedin Walmart
2. site:linkedin.com/in "category manager frozen" Walmart
3. "frozen food" "category manager" grocery west coast Walmart

Open at most two results that look like a specific named person.

After each search, prefix the next step's description with:
QUERY=<what you searched> MATCHES=<how many plausible people> NAMES=<names, or none>

Finish with done and one verdict: IDENTIFIABLE (one person), NARROWED (2-10
people), or NOT IDENTIFIABLE.
```

### B — LinkedIn, using the session already signed in

```
Using LinkedIn, which is already signed in in this browser, find out how far
these three details narrow down one person:
- works at a mid-sized grocery chain in the Western United States
- previously worked at Walmart
- category manager for frozen foods

Navigate to linkedin.com, use the search box for: category manager frozen foods,
then switch the results to People.

Open at most three profiles that plausibly match all three details, one at a
time, going back to the results between profiles.

Do not click Connect, do not click Send, do not click Message, and do not follow
anyone. This is a read-only check.

For each profile you open, prefix the next step's description with:
NAME=<name> COMPANY=<current company> MATCHED=<which of the three details matched>

Finish with done and one verdict: IDENTIFIABLE, NARROWED, or NOT IDENTIFIABLE,
with the count of people who fit all three details.
```

Watch two things here. LinkedIn re-renders constantly and its class names are
machine-generated, so this is the best real test of whether the "prefer
aria-label, role, placeholder, `:has-text`" instruction in `SELECTOR_RULES`
survives contact with a hostile DOM. And if the model does reach a **Send**
button, `isCommitting` should route it to a human hold rather than the healer.

### C — A contact database behind a login (the assisted-run test)

Replace the URL with whichever contact database you are testing.

```
Go to <contact-database-url> and sign in as <your username>.

When you reach the password field, stop — I will type the password myself in the
browser and then resume you. Do not type a password.

Once signed in, search for contacts whose title contains "category manager" at
grocery retailers in CA, OR, WA, NV or AZ, and whose past employer is Walmart.

Do not export, download, email or share anything. Read only.

For each match on the first page of results, prefix the next step's description
with:
NAME=<name> TITLE=<title> COMPANY=<company> PAST=<past employer>

Finish with done and one verdict: IDENTIFIABLE, NARROWED, or NOT IDENTIFIABLE.
```

This rung exists to test the hold path end to end, and the pass condition is
specific: the run parks when the password field appears, you type and press
Resume, the run continues, and the finished run reports **`assisted`** with
`human_steps` ≥ 1 — not `done`. If it reports `done`, the autonomy metric is
lying, which matters more than the research result.

### D — Company shortlist from a vague employer description

```
"A mid-sized grocery chain in the Western United States" was the only employer
detail disclosed.

Work out how many companies that could be. Search google.com for a list of
regional grocery chains in the Western US, then visit the leadership or team
page of the three most likely candidates, one at a time, and check whether any
of them names a category manager for frozen foods.

After each company, prefix the next step's description with:
COMPANY=<name> NAMES_STAFF=<yes|no> DETAIL=<what the page showed>

Finish with done and say how many candidate companies the description leaves.
```

### E — Guard test: this run is supposed to fail

```
Go to <contact-database-url> and sign in with username research@example.com and
password Testing1234.
```

Expected: the model reaches the password field, tries to `type` into it, and
`assertWritableTarget` refuses on the resolved target. That refusal is not
healable, so the run ends **`error`** with the refusal message. A run that ends
any other way — especially one that succeeds — is a real bug in the credential
guard, and worth stopping everything for. Use a throwaway password.

---

## 3. When you need the text itself, not a verdict

Rungs above give you the model's judgement. A publicity check often needs the
paragraph, for the file. That is a routine, not a goal run, because only
`extract` writes into `RunResult.extracted`.

Two ways to get one:

**Use what already ships.** `updates/search-and-capture.json` already does
navigate → wait for the search box → type the query and submit → extract `main`
→ screenshot. Point it at `https://www.google.com` with a query and you get the
results region as text plus a frame. Run this first — if it fails, the failure
is in the extension, not in your prompts.

**Read one known article.** Drop this beside it in `updates/` while testing, and
delete it afterwards — `updates/` is the read-only source of truth for the
routines that ship, and every sync wholesale-replaces the mirror table, so a
test file there becomes a visible system automation. The fs watcher picks it up
within 250 ms; no restart needed.

```json
{
  "id": "test.read-source",
  "name": "Read Source",
  "version": 1,
  "description": "Opens one URL and extracts its main text for a publicity check.",
  "definition": {
    "params": {
      "url": { "description": "Article or profile URL", "required": true }
    },
    "steps": [
      { "kind": "navigate", "url": "{{url}}", "intent": "open the source" },
      { "kind": "wait", "forSelector": "article, main, [role=main]", "intent": "wait for the body text to exist" },
      { "kind": "extract", "selector": "article, main, [role=main]", "into": "body", "intent": "capture the text the check will quote from" },
      { "kind": "screenshot", "label": "source", "intent": "evidence the page looked like this" }
    ]
  }
}
```

`extracted.body` comes back trimmed to 10 000 characters. Note the one live
trap: if a hold happens on the `extract` step, the step never assigns
`vars.body`, and the run can still complete — so an empty `body` on an otherwise
green run means "held", not "empty page".

---

## 4. What to check after each run

| Where | What it tells you |
| ----- | ----------------- |
| Run status | `done` = nobody helped. `assisted` = a hold happened, and rung 2C should be exactly this. `error` on rung 2E is the pass. |
| The thread | Your `FINDING=` / `SOURCE=` / `NAME=` lines, in order. This is the whole research output of a goal run. |
| Screenshots | One per changed frame. A thread with no pictures should still say why — `screenshotError` travels as an imageless artifact. |
| Terminal line | `stopped after 40 steps without reaching the goal` means the prompt covered too many sources; split it. `going in circles` means the model kept retrying one control. |
| `healing` lines | `already failed on this page, so it was not tried again` is the duplicate-selector guard doing its job, and it is the main thing to watch on LinkedIn. |
