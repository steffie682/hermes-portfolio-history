import React from "react";
import { createRoot } from "react-dom/client";
import { GardenView } from "../src/app/garden/view";
import { calculateGarden } from "../src/garden/domain";
import { sampleLots, sampleQuotes } from "../src/app/garden/preview/sample";
createRoot(document.getElementById("app")!).render(
  <GardenView {...calculateGarden(sampleLots, sampleQuotes)} demo />,
);
