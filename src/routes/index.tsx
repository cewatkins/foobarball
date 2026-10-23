import { createFileRoute } from "@tanstack/react-router";
import { Nightline } from "@/game/Nightline";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Nightline />;
}
