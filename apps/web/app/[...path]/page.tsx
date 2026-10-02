import { notFound } from "next/navigation";
import { companies, events, screens } from "../preview/fixtures";
import Preview from "../preview/preview";

export default async function PreviewRoute({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const pathname = `/${path.join("/")}`;
  const item = screens.find((screen) => screen.path === pathname);
  if (item) return <Preview screen={item.screen} />;
  if (
    path[0] === "events" &&
    path.length === 2 &&
    events.some((event) => event.id === path[1])
  ) {
    return <Preview screen="event" eventId={path[1]} />;
  }
  if (
    path[0] === "events" &&
    path.length === 3 &&
    events.some((event) => event.id === path[1]) &&
    ["evidence", "question"].includes(path[2])
  ) {
    return (
      <Preview
        screen={path[2] === "evidence" ? "evidence" : "question"}
        eventId={path[1]}
      />
    );
  }
  if (
    path[0] === "companies" &&
    path.length === 3 &&
    path[2] === "timeline" &&
    companies.some((company) => company.id === path[1])
  ) {
    return (
      <Preview
        screen="timeline"
        eventId={events.find((event) => event.company === path[1])?.id}
      />
    );
  }
  notFound();
}
