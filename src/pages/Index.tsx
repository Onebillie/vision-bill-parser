import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { ApiRetryPanel } from "@/components/ApiRetryPanel";
import { LiveTerminal } from "@/components/LiveTerminal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { JsonViewer } from "@/components/JsonViewer";
import { Link } from "react-router-dom";

const Index = () => {
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedApiCalls, setFailedApiCalls] = useState<any[]>([]);
  const [lastUploadedFilePath, setLastUploadedFilePath] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ timestamp: string; type: "info" | "success" | "error" | "warning"; message: string }>>([]);
  const [parsedResults, setParsedResults] = useState<any>(null);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);

  const addLog = (type: "info" | "success" | "error" | "warning", message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, type, message }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !file) {
      toast({ title: "Error", description: "Please provide phone number and file", variant: "destructive" });
      return;
    }

    setLoading(true);
    setLogs([]);
    
    try {
      addLog("info", "Starting bill parsing process...");
      addLog("info", `Phone: ${phone}`);
      addLog("info", `File: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
      
      // Upload original file as-is (keep PDF for downstream meter API)
      const uploadFile = file;

      // Upload to storage
      addLog("info", "Uploading file to storage...");
      const fileName = `${Date.now()}_${uploadFile.name}`;
      const { error: uploadError } = await supabase.storage.from("bills").upload(fileName, uploadFile);
      
      if (uploadError) throw uploadError;
      setLastUploadedFilePath(fileName);
      addLog("success", `File uploaded: ${fileName}`);

      // Parse bill
      addLog("info", "Invoking AI vision parser...");
      const { data, error } = await supabase.functions.invoke("onebill-vision-parse", {
        body: { phone, file_path: fileName }
      });

      if (error) throw error;
      setParsedResults(data);
      setConfidenceScore(data.confidence_score || null);
      addLog("success", `AI parsing completed (Confidence: ${data.confidence_score || 0}%`);

      if (data.classification) {
        addLog("info", `Document classified as: ${data.classification}`);
      }

      // Log API calls
      if (data.api_calls && data.api_calls.length > 0) {
        addLog("info", `Making ${data.api_calls.length} API call(s)...`);
        data.api_calls.forEach((call: any, index: number) => {
          const status = call.ok ? "success" : "error";
          const message = call.ok 
            ? `API ${index + 1}: ${call.endpoint} - ${call.status}`
            : `API ${index + 1}: ${call.endpoint} - FAILED (${call.status})`;
          addLog(status, message);
        });
      }

      // Check for failed API calls
      const failed = data.api_calls?.filter((call: any) => !call.ok) || [];
      
      if (failed.length > 0) {
        setFailedApiCalls(failed);
        addLog("warning", `${failed.length} API call(s) failed - see retry panel below`);
        toast({
          title: "Some API calls failed",
          description: `${failed.length} API call(s) failed. Edit and retry below.`,
          variant: "destructive"
        });
      } else {
        addLog("success", "All API calls successful!");
        toast({
          title: "Success!",
          description: `Bill parsed and submitted to OneBill API.`,
        });
        // Reset form only on complete success
        setPhone("");
        setFile(null);
        setFailedApiCalls([]);
        (document.getElementById("file-input") as HTMLInputElement).value = "";
      }
    } catch (error: any) {
      addLog("error", `Error: ${error.message || "Failed to process bill"}`);
      toast({
        title: "Error",
        description: error.message || "Failed to process bill",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      addLog("info", "Process completed");
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-4">
              <h1 className="text-3xl font-bold">Utility Bill Parser</h1>
              {confidenceScore !== null && (
                <div className={`px-4 py-2 rounded-lg font-semibold text-sm ${
                  confidenceScore >= 80 ? 'bg-green-500/20 text-green-700 dark:text-green-400' :
                  confidenceScore >= 60 ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                  'bg-red-500/20 text-red-700 dark:text-red-400'
                }`}>
                  Confidence: {confidenceScore}%
                </div>
              )}
            </div>
            <p className="text-muted-foreground">Upload your bill and we'll extract the data</p>
          </div>
          <div className="flex gap-2 justify-center">
            <Link 
              to="/api-configs" 
              className="text-sm text-primary hover:underline"
            >
              → API Configurations
            </Link>
            <span className="text-muted-foreground">|</span>
            <Link 
              to="/training-docs" 
              className="text-sm text-primary hover:underline"
            >
              → Training Docs
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-lg border">
          <div>
            <label className="text-sm font-medium mb-2 block">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+353858007335"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Bill (Image or PDF)</label>
            <input
              id="file-input"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Processing..." : "Upload & Parse"}
          </button>
        </form>

        <LiveTerminal logs={logs} />

        {parsedResults && (
          <Accordion type="single" collapsible className="bg-card rounded-lg border">
            <AccordionItem value="parsed-data" className="border-none">
              <AccordionTrigger className="px-6 hover:no-underline">
                <span className="text-lg font-semibold">
                  View Full JSON Parsing Results
                  {parsedResults.classification_details && (
                    <span className="ml-2 text-sm text-muted-foreground font-normal">
                      (Electricity: {parsedResults.classification_details.electricity_billing_indicators}/6 indicators, 
                      Gas: {parsedResults.classification_details.gas_billing_indicators}/6 indicators)
                    </span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 space-y-4">
                {parsedResults.classification_details?.electricity_date_warnings?.length > 0 && (
                  <div className="p-3 bg-warning/10 border border-warning rounded-md">
                    <p className="text-sm font-semibold text-warning mb-2">⚠️ Electricity Date Warnings:</p>
                    {parsedResults.classification_details.electricity_date_warnings.map((warning: string, idx: number) => (
                      <p key={idx} className="text-xs text-warning/90">{warning}</p>
                    ))}
                  </div>
                )}
                {parsedResults.classification_details?.gas_date_warnings?.length > 0 && (
                  <div className="p-3 bg-warning/10 border border-warning rounded-md">
                    <p className="text-sm font-semibold text-warning mb-2">⚠️ Gas Date Warnings:</p>
                    {parsedResults.classification_details.gas_date_warnings.map((warning: string, idx: number) => (
                      <p key={idx} className="text-xs text-warning/90">{warning}</p>
                    ))}
                  </div>
                )}
                <JsonViewer data={parsedResults} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {failedApiCalls.length > 0 && (
          <ApiRetryPanel 
            failedCalls={failedApiCalls}
            phone={phone}
            filePath={lastUploadedFilePath}
            onRetrySuccess={() => {
              setFailedApiCalls([]);
              toast({ title: "All retries completed" });
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Index;
