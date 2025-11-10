import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LogEntry {
  timestamp: string;
  type: "info" | "success" | "error" | "warning";
  message: string;
}

interface LiveTerminalProps {
  logs: LogEntry[];
}

export const LiveTerminal = ({ logs }: LiveTerminalProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "success":
        return "text-green-400";
      case "error":
        return "text-red-400";
      case "warning":
        return "text-yellow-400";
      default:
        return "text-muted-foreground";
    }
  };

  const getLogPrefix = (type: LogEntry["type"]) => {
    switch (type) {
      case "success":
        return "✓";
      case "error":
        return "✗";
      case "warning":
        return "⚠";
      default:
        return "→";
    }
  };

  if (logs.length === 0) return null;

  return (
    <div className="bg-black/95 rounded-lg border border-border overflow-hidden">
      <div className="bg-muted/10 px-4 py-2 border-b border-border flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-muted-foreground font-mono ml-2">Live Terminal</span>
      </div>
      <ScrollArea className="h-[300px]">
        <div ref={scrollRef} className="p-4 font-mono text-xs space-y-1">
          {logs.map((log, index) => (
            <div key={index} className="flex gap-2">
              <span className="text-muted-foreground/50">[{log.timestamp}]</span>
              <span className={getLogColor(log.type)}>{getLogPrefix(log.type)}</span>
              <span className={getLogColor(log.type)}>{log.message}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
