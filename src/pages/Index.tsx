import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
// import { renderPdfFirstPageToBlob } from "@/lib/pdf-to-image";
import { ApiRetryPanel } from "@/components/ApiRetryPanel";

const Index = () => {
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedApiCalls, setFailedApiCalls] = useState<any[]>([]);
  const [lastUploadedFilePath, setLastUploadedFilePath] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !file) {
      toast({ title: "Error", description: "Please provide phone number and file", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Upload original file as-is (keep PDF for downstream meter API)
      const uploadFile = file;

      // Upload to storage
      const fileName = `${Date.now()}_${uploadFile.name}`;
      const { error: uploadError } = await supabase.storage.from("bills").upload(fileName, uploadFile);
      
      if (uploadError) throw uploadError;
      setLastUploadedFilePath(fileName);

      // Parse bill
      const { data, error } = await supabase.functions.invoke("onebill-vision-parse", {
        body: { phone, file_path: fileName }
      });

      if (error) throw error;

      // Check for failed API calls
      const failed = data.api_calls?.filter((call: any) => !call.ok) || [];
      
      if (failed.length > 0) {
        setFailedApiCalls(failed);
        toast({
          title: "Some API calls failed",
          description: `${failed.length} API call(s) failed. Edit and retry below.`,
          variant: "destructive"
        });
      } else {
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
      toast({
        title: "Error",
        description: error.message || "Failed to process bill",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">OneBill Vision Parse</h1>
          <p className="text-muted-foreground">Upload your utility bill</p>
          <a href="/api-configs" className="text-sm text-primary hover:underline block">
            Manage API Configurations
          </a>
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

        <ApiRetryPanel 
          failedCalls={failedApiCalls}
          phone={phone}
          filePath={lastUploadedFilePath}
          onRetrySuccess={() => {
            setFailedApiCalls([]);
            toast({ title: "All retries completed" });
          }}
        />
      </div>
    </div>
  );
};

export default Index;
