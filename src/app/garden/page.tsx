import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolvePageSessionPrincipal } from "@/auth/page-session";
import { getDatabase } from "@/db/client";
import { createGardenRepository } from "@/garden/repository";
import GardenClient from "./client";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "株の庭 · 保有と配当",
  robots: { index: false, follow: false },
};
export default async function GardenPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) redirect("/login");
  const initialState =
    await createGardenRepository(getDatabase()).load(principal);
  return <GardenClient initialState={initialState} />;
}
