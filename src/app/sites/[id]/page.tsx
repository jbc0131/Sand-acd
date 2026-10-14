import { notFound } from "next/navigation";
import { SiteWorkspace } from "@/components/site/workspace";

export default async function SitePage({ params }: PageProps<"/sites/[id]">) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId) || siteId <= 0) notFound();
  return <SiteWorkspace siteId={siteId} />;
}
