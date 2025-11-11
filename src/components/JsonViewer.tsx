import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface JsonViewerProps {
  data: any;
}

export const JsonViewer = ({ data }: JsonViewerProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        className="absolute top-2 right-2 z-10"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <pre className="text-xs font-mono bg-muted p-4 rounded overflow-auto max-h-96 border">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};
