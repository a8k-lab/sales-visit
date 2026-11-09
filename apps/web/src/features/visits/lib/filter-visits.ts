export type VisitFilters = {
  q: string;
  channel: string;
  member: string;
  outlet: string;
  stock: string;
  date: string;
  offset: string;
};

export function validateVisitSearch(
  search: Partial<VisitFilters>
): VisitFilters {
  const text = (key: keyof VisitFilters) =>
    typeof search[key] === "string" ? search[key] : "";
  return {
    q: text("q").slice(0, 200),
    member: text("member"),
    outlet: text("outlet"),
    channel: ["web", "telegram"].includes(text("channel"))
      ? text("channel")
      : "",
    stock: ["with", "without"].includes(text("stock")) ? text("stock") : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(text("date")) ? text("date") : "",
    offset:
      /^\d{1,6}$/.test(text("offset")) && Number(text("offset")) <= 100000
        ? text("offset")
        : "",
  };
}
