import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStartRoom } from "@/hooks/use-start-room";
import { friendlyError } from "@/lib/friendly-error";
import { normalizeCodeInput, saveToken } from "@/lib/room-token";

import { errorText } from "@/components/unsaid/bits";
import { Shell } from "@/components/unsaid/Shell";

export function meta() {
  return [{ title: "Unsaid: decide with what your team never said" }];
}

// The toolkit's CardTitle is an h3. These cards sit right under the h1, so they are h2s: heading levels must not skip.
function CardHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl font-semibold leading-none tracking-tight">{children}</h2>;
}

const STEPS = [
  ["Notes", "Each person writes what they know, privately."],
  ["Cards", "Notes become one-fact cards. You approve what reaches the shared ledger."],
  ["Weigh", "Everyone rates every fact 0 to 3, blind: no option, no author, no totals."],
  ["Vote", "One sealed vote each."],
  ["Reveal", "Votes open. See which facts only one of you knew, and what they changed."],
] as const;

type Started = ReturnType<typeof useStartRoom>;

const STUDY_DOI = "https://doi.org/10.1037/0022-3514.48.6.1467";
const FACILITATOR_URL = "https://arxiv.org/abs/2508.08242";

/** The result first, then the one big button: the replay opens already at the reveal. */
function ProofStrip({ replay, practice }: { replay: Started; practice: Started }) {
  const busy = replay.pending || practice.pending;
  return (
    <div className="mt-6 max-w-3xl rounded-xl border bg-card p-4 sm:p-6" data-testid="proof-strip">
      <p className="text-xl font-semibold leading-snug sm:text-2xl" data-testid="proof-result">
        <span className="block">Alone, each of three teammates leans to Brightpane Chat.</span>
        <span className="block">With all 15 facts on the table, the ledger points to Kelvane Desk.</span>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">A scripted example with two simulated teammates. 9 of the 15 facts were known to only one person.</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="lg" onClick={() => void replay.go()} disabled={busy} aria-busy={replay.pending} data-testid="see-trap">
          {replay.pending ? "Opening..." : "See the trap in 20 seconds"}
        </Button>
        <p className="text-sm text-muted-foreground">No sign-up. No AI needed for this demo.</p>
      </div>
      {replay.error ? (
        <p role="alert" className={`mt-3 text-sm ${errorText}`} data-testid="see-trap-error">
          {replay.error}{" "}
          <button type="button" className="underline" onClick={() => void practice.go()} disabled={busy}>
            Start the 3-minute practice instead
          </button>
        </p>
      ) : null}
      <div className="mt-5 space-y-2 border-t pt-4 text-sm text-muted-foreground">
        <p data-testid="proof-study">
          The pattern is old. In a 1985 experiment (
          <a className="underline" href={STUDY_DOI} target="_blank" rel="noreferrer">
            Stasser and Titus
          </a>
          ), 83% of 18 groups that all held the full facts chose the candidate those facts pointed to, but only 18% of 38 groups did when the facts were split between members. That was a different experiment: it explains why this matters, it does not measure this tool.
        </p>
        <p data-testid="proof-structure">
          Structure, not an AI facilitator: in a{" "}
          <a className="underline" href={FACILITATOR_URL} target="_blank" rel="noreferrer">
            2025 Microsoft Research experiment
          </a>{" "}
          with 281 groups, a GPT-4o facilitator got more facts said out loud but did not significantly improve the final choice.
        </p>
        <p>We have not tested whether it helps real teams.</p>
      </div>
    </div>
  );
}

function TrapCard({ start }: { start: Started }) {
  return (
    <Card>
      <CardHeader>
        <CardHeading>Fall into the trap yourself</CardHeading>
        <CardDescription>
          A practice room with two simulated teammates. You will lean one way from your own notes, then see what the whole team's facts say. No sign-up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="lg" variant="outline" onClick={() => void start.go()} disabled={start.pending} aria-busy={start.pending} data-testid="try-trap">
          {start.pending ? "Opening..." : "Do it yourself (3 min)"}
        </Button>
        {start.error ? (
          <p role="alert" className={`mt-3 text-sm ${errorText}`}>
            {start.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function JoinCard() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const clean = normalizeCodeInput(code);
  return (
    <Card>
      <CardHeader>
        <CardHeading>Join a room</CardHeading>
        <CardDescription>Got a room code or an invite link? Enter the code, then pick a name.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean.length >= 4) navigate(`/r/${clean}`);
          }}
        >
          <Input aria-label="Room code" placeholder="Room code" className="font-mono uppercase tracking-widest" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit" variant="outline" disabled={clean.length < 4}>
            Join
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StartRoomCard() {
  const navigate = useNavigate();
  const make = useActionMutation("create-room");
  const [retrying, setRetrying] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [name, setName] = useState("");
  const filled = options.map((o) => o.trim()).filter(Boolean);
  // The same rules the server applies (domain/room.ts), so a click never ends in an error.
  const optionHint = filled.some((o) => o.length < 2)
    ? "Each option needs at least 2 characters."
    : new Set(filled.map((o) => o.toLowerCase())).size < filled.length
      ? "Each option needs a different name."
      : null;
  const valid = question.trim().length >= 3 && filled.length >= 2 && !optionHint && name.trim().length > 0;
  const busy = make.isPending || retrying;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const input = { question: question.trim(), options: filled, name: name.trim() };
    try {
      let r;
      try {
        r = await make.mutateAsync(input);
      } catch (err) {
        // One quiet second try after 1 s for a server fault or a lost connection (the live site answered 500 once in 7 first clicks); a 4xx would answer the same. A duplicate empty room is harmless.
        const status = (err as { status?: unknown } | null)?.status;
        if (typeof status === "number" && status < 500) throw err;
        setRetrying(true);
        await new Promise((go) => setTimeout(go, 1000));
        r = await make.mutateAsync(input);
      }
      saveToken(r.code, r.token);
      navigate(`/r/${r.code}`);
    } catch {
      // make.error carries the message
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardHeading>Start a room</CardHeading>
        <CardDescription>For a real decision with your team. You get a link to share. No account, no email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="space-y-1.5">
            <Label htmlFor="q">The decision</Label>
            <Input id="q" dir="auto" maxLength={200} placeholder="Which vendor should we sign?" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">The options (2 to 4)</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${i + 1}`}
                  dir="auto"
                  aria-describedby={optionHint ? "option-hint" : undefined}
                  minLength={2}
                  maxLength={40}
                  placeholder={`Option ${i + 1}`}
                  value={o}
                  onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {options.length > 2 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}>
                    <IconX size={16} aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}
            {optionHint ? (
              <p id="option-hint" className="text-sm text-muted-foreground">
                {optionHint}
              </p>
            ) : null}
            {options.length < 4 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setOptions((all) => [...all, ""])}>
                <IconPlus size={16} aria-hidden /> Add an option
              </Button>
            ) : null}
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="n">Your name</Label>
            <Input id="n" maxLength={40} placeholder="e.g. Dana" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={!valid || busy} aria-busy={busy} data-testid="start-room">
            {busy ? "Starting..." : "Start a room"}
          </Button>
          {make.error && !retrying ? (
            <p role="alert" className={`text-sm ${errorText}`}>
              {friendlyError(make.error)}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const replay = useStartRoom("create-replay-room");
  const practice = useStartRoom("create-practice-room");
  return (
    <Shell>
      <section className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">See what your team never said.</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Teams decide on the facts that get said out loud. Unsaid collects what each person knows, lets everyone weigh every fact blind, and shows which facts only one of you knew and what they change.
        </p>
      </section>

      <ProofStrip replay={replay} practice={practice} />

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <TrapCard start={practice} />
          <JoinCard />
        </div>
        <StartRoomCard />
      </div>

      <section className="mt-14" aria-labelledby="how-title">
        <h2 id="how-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          How a room works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-5">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="text-sm">
              <p className="font-semibold">
                {i + 1}. {title}
              </p>
              <p className="mt-1 text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-sm text-muted-foreground">Unsaid never votes or recommends. These are your team's facts and your team's weights.</p>
      </section>
    </Shell>
  );
}
