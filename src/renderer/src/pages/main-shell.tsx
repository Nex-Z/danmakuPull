import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";

export function MainShell() {
  return (
    <div className="grid min-h-screen bg-transparent md:grid-cols-[320px_1fr]">
      <AppSidebar />
      <main className="min-h-screen">
        <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-6 py-6 md:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
