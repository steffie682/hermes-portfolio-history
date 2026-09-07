import type { Metadata } from "next";
import { calculateGarden } from "@/garden/domain";
import { GardenView } from "../view";
import { sampleLots, sampleQuotes } from "./sample";
export const metadata: Metadata = {
  title: "株の庭 · サンプル",
  robots: { index: false, follow: false },
};
export default function GardenPreview() {
  return <GardenView {...calculateGarden(sampleLots, sampleQuotes)} demo />;
}
