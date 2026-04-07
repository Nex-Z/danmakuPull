import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Route, Routes } from "react-router-dom";
import { MainShell } from "@/pages/main-shell";
import { ResourcesPage } from "@/pages/resources-page";
import { SearchPage } from "@/pages/search-page";
import { SettingsPage } from "@/pages/settings-page";
import { TasksPage } from "@/pages/tasks-page";
import { OverlayPage } from "@/pages/overlay-page";

export default function App() {
  return (
    <TooltipProvider>
      <Routes>
        <Route path="/overlay" element={<OverlayPage />} />
        <Route path="/" element={<MainShell />}>
          <Route index element={<SearchPage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster position="top-right" richColors />
    </TooltipProvider>
  );
}
