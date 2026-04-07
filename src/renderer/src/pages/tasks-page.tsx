import { useEffect, useState } from "react";
import { Ban, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FetchJob } from "@shared/types";

function renderBadge(job: FetchJob) {
  if (job.status === "completed") {
    return <Badge variant="secondary">Completed</Badge>;
  }
  if (job.status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (job.status === "cancelled") {
    return <Badge variant="outline">Cancelled</Badge>;
  }
  return <Badge variant="outline">{job.status}</Badge>;
}

export function TasksPage() {
  const [jobs, setJobs] = useState<FetchJob[]>([]);

  useEffect(() => {
    let disposed = false;

    async function refresh() {
      const data = await window.app.fetch.listJobs();
      if (!disposed) {
        setJobs(data);
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  async function cancel(jobId: number) {
    await window.app.fetch.cancel(jobId);
    toast.success(`已请求取消任务 #${jobId}`);
    setJobs(await window.app.fetch.listJobs());
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="text-sm uppercase tracking-[0.28em] text-primary/70">
          Tasks
        </div>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">抓取任务</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          这里会展示最近的缓存抓取任务。首版使用简单任务模型，便于从搜索、资源页和 overlay 按需触发。
        </p>
      </div>

      <Card className="border-border/70 bg-card/90">
        <CardHeader>
          <CardTitle>最近任务</CardTitle>
          <CardDescription>任务列表每 2 秒自动刷新一次。</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
              还没有触发任何任务。
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead className="w-40 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-foreground">#{job.id}</div>
                        <div className="text-sm text-muted-foreground">资源 {job.resourceId}</div>
                      </div>
                    </TableCell>
                    <TableCell>{renderBadge(job)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {(job.status === "running" || job.status === "queued") && (
                          <LoaderCircle className="size-4 animate-spin" />
                        )}
                        <span>{job.message || "等待中…"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {(job.status === "running" || job.status === "queued") ? (
                          <Button variant="outline" onClick={() => void cancel(job.id)}>
                            <Ban data-icon="inline-start" />
                            取消
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">已结束</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
