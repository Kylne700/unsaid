import { useActionMutation } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/friendly-error";
import { saveToken } from "@/lib/room-token";

import type { GuestView } from "../../../server/domain/view";
import { errorText, OptionTag } from "./bits";
import { Shell } from "./Shell";

/** What someone sees at a room link without a seat: the question and, while the room is still in the notes phase, a name box. */
export function JoinGate({ view, onJoined }: { view: GuestView; onJoined: (token: string) => void }) {
  const navigate = useNavigate();
  const join = useActionMutation("join-room");
  const startPractice = useActionMutation("create-practice-room");
  const [name, setName] = useState("");
  const joinError = join.error ? friendlyError(join.error, "join") : null;
  const practiceError = startPractice.error ? friendlyError(startPractice.error) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await join.mutateAsync({ code: view.code, name: name.trim() });
      onJoined(r.token);
    } catch {
      // join.error carries the message
    }
  }

  async function newPractice() {
    try {
      const r = await startPractice.mutateAsync({});
      saveToken(r.code, r.token);
      navigate(`/r/${r.code}`);
    } catch {
      // startPractice.error carries the message
    }
  }

  return (
    <Shell right={<span className="font-mono tracking-widest">{view.code}</span>}>
      <div className="mx-auto max-w-lg">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{view.practice ? "Practice room" : "You are invited to a decision room"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight" data-testid="join-question" dir="auto">
          {view.question}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          {view.options.map((o) => (
            <OptionTag key={o.id} options={view.options} id={o.id} />
          ))}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {view.memberCount} {view.memberCount === 1 ? "person is" : "people are"} in this room.
        </p>

        {view.joinable ? (
          <form className="mt-8 space-y-3" onSubmit={(e) => void submit(e)}>
            {view.tokenInvalid ? <p className="text-sm text-muted-foreground">This browser's saved seat is not in this room. Join again with a name.</p> : null}
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              autoFocus
              maxLength={40}
              placeholder="e.g. Dana"
              value={name}
              aria-invalid={joinError ? true : undefined}
              aria-describedby={joinError ? "join-error" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (join.error) join.reset();
              }}
            />
            {joinError ? (
              <p id="join-error" role="alert" className={`text-sm ${errorText}`}>
                {joinError}
              </p>
            ) : null}
            <Button type="submit" disabled={!name.trim() || join.isPending} aria-busy={join.isPending}>
              {join.isPending ? "Joining..." : "Join room"}
            </Button>
            <p className="text-xs text-muted-foreground">No account and no email. Your seat is saved in this browser only.</p>
          </form>
        ) : view.practice ? (
          <div className="mt-8 space-y-3">
            <p className="text-sm text-muted-foreground">Practice rooms belong to one person and cannot be joined. You can start your own.</p>
            <Button onClick={() => void newPractice()} disabled={startPractice.isPending} aria-busy={startPractice.isPending}>
              {startPractice.isPending ? "Opening..." : "Try the trap (3 min)"}
            </Button>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              This room has moved past the notes phase, so new people can no longer join. If you were in it, open this link in the browser you joined from.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/" data-testid="late-start-room">
                  Start your own room
                </Link>
              </Button>
              <Button variant="outline" onClick={() => void newPractice()} disabled={startPractice.isPending} aria-busy={startPractice.isPending} data-testid="late-practice">
                {startPractice.isPending ? "Opening..." : "Try the practice room"}
              </Button>
            </div>
          </div>
        )}
        {practiceError ? (
          <p role="alert" className={`mt-3 text-sm ${errorText}`}>
            {practiceError}
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
