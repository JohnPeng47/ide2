import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { MappingPocPage } from "../features/mapping/MappingPage";
import { StudioPage } from "../features/studio/StudioPage";
import { ExperimentViewerPage } from "../features/studio/experiments/ExperimentViewerPage";

type AppPage = "studio" | "experiments" | "mapping";

export function pageFromPath(pathname = window.location.pathname): AppPage {
  if (pathname.startsWith("/experiments")) return "experiments";
  if (pathname.startsWith("/mapping")) return "mapping";
  return "studio";
}

export function App() {
  const [page, setPage] = useState(pageFromPath);
  const navigationGuard = useRef<(() => boolean) | undefined>(undefined);
  const guardedUrl = useRef(window.location.href);
  const registerNavigationGuard = useCallback((guard: (() => boolean) | undefined) => {
    navigationGuard.current = guard;
    if (guard) guardedUrl.current = window.location.href;
  }, []);
  useEffect(() => {
    const onPopState = () => {
      if (pageFromPath() !== "mapping" && navigationGuard.current && !navigationGuard.current()) {
        window.history.pushState({}, "", guardedUrl.current);
        return;
      }
      setPage(pageFromPath());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (next: AppPage) => {
    if (next !== "mapping" && navigationGuard.current && !navigationGuard.current()) return;
    const path = next === "experiments" ? "/experiments" : next === "mapping" ? "/mapping" : "/";
    window.history.pushState({}, "", path);
    setPage(next);
  };
  if (page === "experiments") {
    return <ExperimentViewerPage
      onStudio={() => navigate("studio")}
      onMapping={() => navigate("mapping")}
    />;
  }
  if (page === "mapping") {
    return <MappingPocPage
      registerNavigationGuard={registerNavigationGuard}
      onStudio={() => navigate("studio")}
      onExperiments={() => navigate("experiments")}
    />;
  }
  return <StudioPage
    onOpenProjectDiagram={(id) => { window.history.pushState({}, "", `/mapping?diagram=${encodeURIComponent(id)}`); setPage("mapping"); }}
    onExperiments={() => navigate("experiments")}
    onMapping={() => navigate("mapping")}
  />;
}
