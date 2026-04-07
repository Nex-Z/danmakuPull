import { Film, FolderKanban, Search, Settings2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const entries = [
  {
    to: "/",
    label: "搜索管理",
    description: "选择平台、搜索影片、直接播放弹幕",
    icon: Search
  },
  {
    to: "/resources",
    label: "资源缓存",
    description: "管理已保存资源与播放入口",
    icon: FolderKanban
  },
  {
    to: "/tasks",
    label: "抓取任务",
    description: "查看预抓任务与运行状态",
    icon: Film
  },
  {
    to: "/settings",
    label: "平台设置",
    description: "凭证、UA、缓存和默认行为",
    icon: Settings2
  }
];

export function AppSidebar() {
  return (
    <aside className="flex h-full flex-col border-r border-border/70 bg-card/80 backdrop-blur">
      <div className="flex flex-col gap-3 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium uppercase tracking-[0.28em] text-primary/70">
              Danmaku
            </div>
            <div className="text-xl font-semibold text-foreground">
              Overlay Console
            </div>
          </div>
          <Badge variant="secondary">Electron</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          面向 Bilibili 与腾讯视频的本地弹幕搜索、缓存与悬浮播放工具。
        </p>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-2 px-3 py-4">
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "group rounded-2xl border border-transparent px-4 py-3 transition-colors",
                    isActive
                      ? "border-primary/20 bg-primary/10"
                      : "hover:border-border/80 hover:bg-background/80"
                  )
                }
              >
                {({ isActive }) => (
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "rounded-xl border border-border/70 bg-background p-2 text-muted-foreground transition-colors",
                        isActive && "border-primary/40 bg-primary/10 text-primary"
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {entry.label}
                      </div>
                      <div className="mt-1 text-sm leading-5 text-muted-foreground">
                        {entry.description}
                      </div>
                    </div>
                  </div>
                )}
              </NavLink>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
