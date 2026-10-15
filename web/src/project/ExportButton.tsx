// The export of a project: every size of it rendered on the server into one ZIP.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../api.ts";
import { rendersQuery, startRender, working } from "../renders.tsx";
import type { ProjectStore } from "../state/useDraft.ts";
import { track } from "../track.ts";
import { toast } from "../ui/index.ts";

/**
 * Renders every size of the project on the server: each device from its own slides, and each display of App Store
 * Connect gets its own folder. The run works in the background, the sidebar follows it, and the ZIP downloads when
 * it is done. It starts only once the server has every edit, so the ZIP is what the screen shows.
 */
export function ExportButton({ id, store }: { id: string; store: ProjectStore }) {
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  // The render of this project that is waiting or under way, wherever it was started.
  const rendering = useQuery(rendersQuery).data?.jobs.find((job) => job.project === id && working(job));

  const exportZip = async () => {
    setExporting(true);
    try {
      if (!(await store.flush())) {
        toast("Your latest changes are not saved yet, so the ZIP would leave them out. Export again once they are saved.", "error", 8000);
        return;
      }
      await startRender(queryClient, id);
      track("export", { kind: "screenshots" });
      toast("Rendering in the background. Keep working: the ZIP downloads when it is done.", "", 6000);
    } catch (error) {
      toast(errorText(error), "error", 8000);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button className="btn primary" type="button" disabled={exporting || rendering != null} onClick={() => void exportZip()}>
      {rendering ? (rendering.state === "running" && rendering.total ? `Rendering ${rendering.done} of ${rendering.total}` : "Rendering…") : exporting ? "Starting…" : "Export ZIP"}
    </button>
  );
}
