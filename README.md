# Unsaid

A group decision room. Everyone adds what they know, everyone rates every fact without seeing who wrote it, the votes are sealed, and the reveal shows which facts one person held and what they changed.

Live demo: LIVE_URL_TBD

Made for the Builder.io Agent-Native hackathon.

![The cards phase: your own cards in full, a count of the cards the others approved](docs/shots/03-cards.png)

## What Unsaid is, and why

Teams tend to talk about what everyone already knows. In a classic experiment, 83% of 18 groups picked the best candidate when every member had all the facts, but 18% of 38 groups did when the facts were split between members (Stasser & Titus, 1985, Journal of Personality and Social Psychology 48(6)). A meta-analysis of 65 studies found split-fact groups about 8 times less likely to find the best option (Lu, Yuan & McLeod, 2012, [PubMed 21896790](https://pubmed.ncbi.nlm.nih.gov/21896790/)). The effect is called the hidden profile.

Unsaid tries to give a fact that one person holds a way onto the table. People write what they know, the facts become cards, the room rates every card without option names or authors, and the reveal shows which facts one person held and whether they moved the ranking. The research describes the problem. We have not tested whether Unsaid helps real teams.

Unsaid never votes or recommends. These are your team's facts and your team's weights.

## How a room works

One person starts a room with a question and two or more options and shares the room code or invite link. Everyone else joins with a name. A phase ends when every member marks done (in the vote, when every member has voted). Whoever made the room can also move it on.

1. **Notes.** You write what you know. The other members do not see your notes. You can seal which option you lean to; the others do not see it until the reveal.
2. **Cards.** "Draft cards from my notes" turns your notes into draft cards: one fact about one option, as a pro or a con. You edit them and approve the ones you want into the shared ledger. In this phase you see your own approved cards in full and a count of the cards the others have approved. The full ledger opens when the room moves on to weigh. If two of your own cards state the same fact, you can merge them, and split them again.
3. **Weigh.** Everyone rates every fact from 0 to 3, in their own shuffled order, with no option name, no author and no running totals. A card's weight is the mean of everyone's ratings. A pro adds its weight to its option and a con takes it away. A tie is shown as a tie.
4. **Vote.** One sealed vote each. You can also say how many of the others you expect to pick what you pick (the alone check) and, in a room of three or more, guess who knew a fact that exactly one other person knew (guess who).
5. **Reveal.** Who held each fact, each person's lean and each vote open up. The room sees the ranking from all facts next to the ranking from the facts that two or more people held, and which single-holder facts moved it.

To try it without a team, "Try the trap" opens a practice room: a made-up vendor decision, you, and two scripted teammates that are labelled as simulated.

What a phase hides is removed on the server before it answers (`viewRoom` in `server/domain/view.ts`). The screen and the room assistant get the same answer, and the assistant's copy has the guess data taken out.

![The reveal](docs/shots/07-reveal-full.png)

## Run it locally

You need Node 22.22 or newer and pnpm 10 (`corepack enable` gives you the right one).

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` opens the app. Locally the database is an embedded PGlite folder (`data/pglite`), so there is nothing to set up.

The AI features need a Gemini API key in a `.env` file (git-ignored):

```
UNSAID_GEMINI_API_KEY=your-key
```

Leave `GOOGLE_GENERATIVE_AI_API_KEY` and `GEMINI_API_KEY` unset: the app throws at start-up if either is set. If no key is set, "Draft cards from my notes" falls back to a plain sentence splitter, and the room chat needs the key.

Checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm agent-native:doctor
```

The browser checks drive a headless Chromium against a running dev server (`http://127.0.0.1:18744`, or pass `--base=<url>`). Playwright is not an app dependency, so point them at a copy of `playwright-core`:

```bash
node scripts/e2e/practice.mjs --pw-core=<path to playwright-core/index.mjs>
node scripts/e2e/live.mjs --pw-core=<path to playwright-core/index.mjs>
```

`scripts/e2e/agent.mjs` runs the room chat against the real Gemini API (about 15 requests per run). The browser checks rewrite the screenshots in `docs/shots`.

## Pre-existing work

The hackathon asks to name what was there before. Nothing in this repository predates the scaffold commit.

- **Template.** The app started from the Agent-Native `chat` starter template (`@agent-native/core` 0.225.0, MIT, scaffolded with `create`). The untouched scaffold is the baseline commit `6aa14f7`, so `git diff 6aa14f7..HEAD` shows what we changed. It was committed on 6 November 2026.
- **Libraries.** Agent-Native (`@agent-native/core`, `agentkit`, `toolkit`, `otel`), React, React Router, TanStack Query, Vite, Tailwind CSS, Radix UI, Tabler icons, Zod, Drizzle ORM, PGlite, the Vercel AI SDK with its Google provider (the Gemini connection) and Vitest.
- **Assets and docs.** The icons, logos and favicon in `public/`, the Inter font (`@fontsource-variable/inter`) and the template's own guides (`AGENTS.md`, `DEVELOPING.md`, `DESIGN.md`, `.agents/skills`) are from the template or its packages, unchanged.
- **Template files we changed (8).** `app/root.tsx` and `server/plugins/auth.ts` (Unsaid's pages are public, the template's own routes stay behind sign-in), `app/routes/_index.tsx` (the home page), `server/plugins/agent-chat.ts` (the room assistant's prompt, its 13-tool list and the Gemini engine), `server/plugins/agent-native-email-branding.ts` (app name, engine choice), `actions/navigate.ts` (keeps navigation inside the app), and `agent-native.config.ts` and `agent-native.json` (one setting each). We deleted the template's example action `actions/hello.ts` and `actions/provider-api-request.ts`, and replaced this README.
- **What we wrote.**
  - `server/domain/`: the room rules (phases, cards, ledger maths, guess meter, practice room) as plain functions over one JSON document, with unit tests.
  - `server/db/`: storage for rooms and the daily AI counters.
  - `server/lib/`: the Gemini connection and its guards (the one place that reads the key, daily caps, tied to a room seat), guest seats and request helpers.
  - `actions/`: the 18 room actions. The screen and the room assistant call the same ones.
  - `app/`: the home page, the room screen with its five phase screens (`app/components/unsaid`, `app/routes/r.$code.tsx`) and the polling hook.
  - `server/scenarios/vendor.json`: the practice scenario, a made-up vendor decision written for this project.
  - `scripts/e2e/` and `docs/shots/`: the browser checks and the screenshots they take.

## AI disclosure

- **How it was built.** Built with AI coding assistance: Claude (from Anthropic), working in Claude Code, wrote and edited much of the code, the tests and this README. It was directed by Kylne700. Commits made with Claude carry a `Co-Authored-By` line.
- **In the app.** The AI in a room is Google Gemini (`gemini-3.5-flash-lite`). It drafts cards from your notes and answers questions about your room in the chat. It acts as the member who is talking to it and sees what that member sees, with the guess data taken out. It has no action to vote, rate a card, guess who or set your lean, and its instructions forbid it to recommend an option or rank the options. You approve every card yourself.

## Data note

Unsaid sends text to Google's Gemini API (model `gemini-3.5-flash-lite`, free tier) in two places: when you press "Draft cards from my notes" (your notes and the room's option names) and when you chat with the room assistant (your messages and the room details it reads for you). Google's terms for the unpaid Gemini API (https://ai.google.dev/gemini-api/terms, as read on 30 October 2026) say "human reviewers may read, annotate, and process your API input and output." and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." So use made-up or non-sensitive text. The same notice is shown under the notes box in the app. If no key is set, nothing is sent to Google.

## Known limits

- **The guess-who number is one number for the whole room.** If all members but one pool their own results, they can work out the last member's score. The number stays hidden unless at least three people guessed and the guesses were neither all right nor all wrong. Its "above, near or below luck" reading is a rough two-standard-deviations rule, not a significance test.
- **"Done" flags are visible.** The whole room can see who has marked done (in the vote, who has voted), not what they voted.
- **Names show at the reveal, by design.** The reveal shows who held each fact, each person's lean and each vote. Before it, the room is told whether you hold a card and how many people hold it, not who.
- **Daily AI caps.** The app allows 350 AI requests a day in total and 40 a day per member (UTC days). After that, or for a minute after Gemini answers "too many requests", the AI stops and says so; everything else in the room keeps working by hand.
- **The others' card count ticks live.** In the cards phase you see how many cards the others have approved. The number changes whenever someone approves or withdraws a card. It carries no text, author or id.
- **Duplicates across members are not merged (a regression).** Since members cannot see each other's cards before weigh, nobody can merge a card with a duplicate written by someone else. In a live room, two members who wrote the same fact end up with two cards, each counted as known by one person. The reveal then counts too many facts as known by one person and has little to compare in its ranking of facts that several people held. The practice room is not affected: it joins identical scripted facts itself.

## License

The template this app started from is MIT licensed (Copyright (c) 2026 Builder.io, Inc.). Its license terms are kept intact: the full MIT text and copyright notice are in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). Libraries installed from npm keep their own licenses. This repository has no license file of its own yet.
