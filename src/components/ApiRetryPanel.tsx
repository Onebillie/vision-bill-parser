import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface FailedApiCall {
  type: string;
  endpoint: string;
  status: number;
  error?: string;
  response?: string;
  payload: any;
}

interface ApiRetryPanelProps {
  failedCalls: FailedApiCall[];
  phone: string;
  onRetrySuccess: () => void;
}

export const ApiRetryPanel = ({ failedCalls, phone, onRetrySuccess }: ApiRetryPanelProps) => {
  const [editedPayloads, setEditedPayloads] = useState<Record<string, string>>(
    Object.fromEntries(
      failedCalls.map((call, idx) => [
        `${call.type}-${idx}`,
        JSON.stringify(call.payload, null, 2)
      ])
    )
  );
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const handleRetry = async (call: FailedApiCall, index: number) => {
    const key = `${call.type}-${index}`;
    setRetrying(prev => ({ ...prev, [key]: true }));

    try {
      const payload = JSON.parse(editedPayloads[key]);
      
      const response = await fetch(call.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${import.meta.env.VITE_ONEBILL_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.text();

      if (response.ok) {
        toast({
          title: "Success!",
          description: `${call.type} API call succeeded`
        });
        onRetrySuccess();
      } else {
        toast({
          title: "Retry Failed",
          description: `Status ${response.status}: ${result.slice(0, 200)}`,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to retry API call",
        variant: "destructive"
      });
    } finally {
      setRetrying(prev => ({ ...prev, [key]: false }));
    }
  };

  if (failedCalls.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-destructive">Failed API Calls</h2>
      {failedCalls.map((call, index) => {
        const key = `${call.type}-${index}`;
        return (
          <Card key={key} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="destructive" className="mb-2">{call.type.toUpperCase()}</Badge>
                <p className="text-sm text-muted-foreground">{call.endpoint}</p>
              </div>
              <Badge variant="outline">Status: {call.status}</Badge>
            </div>

            {call.error && (
              <div className="bg-destructive/10 p-3 rounded text-sm">
                <p className="font-medium">Error:</p>
                <p className="text-destructive">{call.error}</p>
              </div>
            )}

            {call.response && (
              <div className="bg-muted p-3 rounded text-sm">
                <p className="font-medium mb-1">Response:</p>
                <pre className="whitespace-pre-wrap text-xs">{call.response.slice(0, 500)}</pre>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-2 block">
                Edit Payload (JSON):
              </label>
              <Textarea
                value={editedPayloads[key]}
                onChange={(e) => setEditedPayloads(prev => ({ ...prev, [key]: e.target.value }))}
                className="font-mono text-xs min-h-[200px]"
              />
            </div>

            <Button
              onClick={() => handleRetry(call, index)}
              disabled={retrying[key]}
              className="w-full"
            >
              {retrying[key] ? "Retrying..." : "Retry API Call"}
            </Button>
          </Card>
        );
      })}
    </div>
  );
};
