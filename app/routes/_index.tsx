import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeCodeInput, saveToken } from "@/lib/room-token";

import { errorText } from "@/components/unsaid/bits";
import { Shell } from "@/components/unsaid/Shell";

export function meta() {
  return [{ title: "Unsaid: decide with what your team never said" }];
}

const STEPS = [
  ["Notes", "Each person writes what they know, privately."],
  ["Cards", "Notes become one-fact cards. You approve what reaches the shared ledger."],
  ["Weigh", "Everyone rates every fact 0 to 3, blind: no option, no author, no totals."],
  ["Vote", "One sealed vote each."],
  ["Reveal", "Votes open. See which facts only one of you knew, and what they changed."],
] as const;

function TrapCard() {
  const navigate = useNavigate();
  const make = useActionMutation("create-practice-room");
  async function go() {
    try {
      const r = await make.mutateAsync({});
      saveToken(r.code, r.token);
      navigate(`/r/${r.code}`);
    } catch {
      // make.error carries the message
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fall into the trap yourself</CardTitle>
        <CardDescription>
          A practice room with two simulated teammates. You will lean one way from your own notes, then see what the whole team's facts say. No sign-up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="lg" onClick={() => void go()} disabled={make.isPending} data-testid="try-trap">
          Try the trap (3 min)
        </Button>
        {make.error ? (
          <p role="alert" className={`mt-3 text-sm ${errorText}`}>
            {actionErrorMessage(make.error)}
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
        <CardTitle>Join a room</CardTitle>
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
          <Button type="submit" variant="secondary" disabled={clean.length < 4}>
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
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [name, setName] = useState("");
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length >= 3 && filled.length >= 2 && name.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      const r = await make.mutateAsync({ question: question.trim(), options: filled, name: name.trim() });
      saveToken(r.code, r.token);
      navigate(`/r/${r.code}`);
    } catch {
      // make.error carries the message
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a room</CardTitle>
        <CardDescription>For a real decision with your team. You get a link to share. No account, no email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="space-y-1.5">
            <Label htmlFor="q">The decision</Label>
            <Input id="q" maxLength={200} placeholder="Which vendor should we sign?" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">The options (2 to 4)</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${i + 1}`}
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
          <Button type="submit" disabled={!valid || make.isPending} data-testid="start-room">
            Start a room
          </Button>
          {make.error ? (
            <p role="alert" className={`text-sm ${errorText}`}>
              {actionErrorMessage(make.error)}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  return (
    <Shell>
      <section className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">See what your team never said.</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Teams decide on the facts that get said out loud. Unsaid collects what each person knows, lets everyone weigh every fact blind, and shows which facts only one of you knew and what they change.
        </p>
      </section>

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <TrapCard />
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
