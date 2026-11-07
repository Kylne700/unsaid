import { redirect } from "react-router";

/** The loader of every starter screen Unsaid does not use (agent, chat, database, extensions, home, observability, settings, team): visitors go to the start page. */
export const loader = () => redirect("/");
