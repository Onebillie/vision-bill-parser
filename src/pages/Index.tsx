import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ParsingProgress } from "@/components/ParsingProgress";
import { renderPdfFirstPageToBlob } from "@/lib/pdf-to-image";

const Index = () => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [progressStep, setProgressStep] = useState<"idle" | "uploading" | "analyzing" | "sending" | "complete" | "error">("idle");
  const { toast } = useToast();

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadedFile(file);
    setProgressStep("uploading");
    
    try {
      let fileToUpload: File = file;
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        try {
          const pngBlob = await renderPdfFirstPageToBlob(file, 1800);
          fileToUpload = new File([pngBlob], `${Date.now()}.png`, { type: 'image/png' });
        } catch (e) {
          console.warn('PDF to image conversion failed, uploading original PDF instead', e);
          fileToUpload = file; // fallback
        }
      }

      const fileExt = fileToUpload.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('bills')
        .upload(filePath, fileToUpload, {
          contentType: fileToUpload.type,
          upsert: true
        });

      if (uploadError) throw uploadError;

      toast({
        title: "Upload complete",
        description: isPdf ? "Converted PDF and uploaded image. Parsing now..." : "File uploaded successfully. Parsing now..."
      });

      // Auto-parse after upload
      await handleParse(filePath);
    } catch (error: any) {
      setProgressStep("error");
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  const handleParse = async (filePath?: string) => {
    if (!filePath) {
      toast({
        title: "Error",
        description: "Please upload a file",
        variant: "destructive"
      });
      return;
    }

    if (!phone.trim()) {
      toast({
        title: "Error",
        description: "Phone number is required",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setResult(null);
    if (!filePath) {
      setProgressStep("uploading");
    }

    try {
      setProgressStep("analyzing");
      const payload: any = { phone, file_path: filePath };

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onebill-vision-parse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
          },
          body: JSON.stringify(payload)
        }
      );

      setProgressStep("sending");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Parse failed");
      }

      setProgressStep("complete");
      setResult(data);
      toast({
        title: "Success",
        description: data.ok ? "Sent to ONEBILL API successfully!" : "Parsed but API call failed"
      });
      
      // Reset progress after 2 seconds
      setTimeout(() => setProgressStep("idle"), 2000);
    } catch (error: any) {
      setProgressStep("error");
      toast({
        title: "Error",
        description: error.message || "Failed to parse document",
        variant: "destructive"
      });
      
      // Reset progress after 3 seconds
      setTimeout(() => setProgressStep("idle"), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">OneBill Vision Parse</h1>
          <p className="text-muted-foreground">
            Upload an Irish utility bill image to extract structured data
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Parse Document</CardTitle>
            <CardDescription>
              Upload a meter reading, gas bill, or electricity bill (JPG, PNG, WEBP, PDF)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Phone Number */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone Number *</label>
              <Input
                placeholder="+353 XX XXX XXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading || uploading}
              />
            </div>
            {/* File Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload File</label>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
                onClick={() => document.getElementById('file-input')?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('border-primary');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-primary');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-primary');
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileUpload(file);
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {uploading ? "Uploading..." : uploadedFile ? uploadedFile.name : "Drag and drop or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports JPG, PNG, WEBP, PDF (max 20MB)
                </p>
              </div>
              <input
                id="file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                disabled={uploading || loading}
              />
            </div>
          </CardContent>
        </Card>

        <ParsingProgress currentStep={progressStep} />

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {result.ok ? "✓ All API calls successful" : "⚠ Some API calls failed"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {result.services_detected && (
                <div>
                  <h4 className="font-semibold mb-2 text-base">Services Detected:</h4>
                  <div className="flex gap-2">
                    {result.services_detected.electricity && (
                      <span className="px-3 py-1 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded-full text-sm">
                        ⚡ Electricity
                      </span>
                    )}
                    {result.services_detected.gas && (
                      <span className="px-3 py-1 bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-full text-sm">
                        🔥 Gas
                      </span>
                    )}
                    {result.services_detected.broadband && (
                      <span className="px-3 py-1 bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded-full text-sm">
                        📡 Broadband
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t pt-6">
                <h4 className="font-semibold mb-3 text-lg">Complete Parsed JSON</h4>
                <p className="text-xs text-muted-foreground mb-3">This is the full structured data sent to the OneBill API</p>
                <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-[500px] border">
                  {JSON.stringify(result.parsed_data || result.data, null, 2)}
                </pre>
              </div>

              {result.api_calls && result.api_calls.length > 0 && (
                <div className="border-t pt-6">
                  <h4 className="font-semibold mb-3 text-lg">OneBill API Responses</h4>
                  <div className="space-y-3">
                    {result.api_calls.map((call: any, idx: number) => (
                      <div key={idx} className="p-4 bg-muted rounded-lg border">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className={`text-lg ${call.ok ? 'text-green-600' : 'text-red-600'}`}>
                              {call.ok ? '✓' : '✗'}
                            </span>
                            <div>
                              <div className="font-semibold capitalize">{call.type} Service</div>
                              <div className="text-xs text-muted-foreground">HTTP {call.status}</div>
                            </div>
                          </div>
                          <span className={`px-3 py-1 rounded text-xs font-medium ${
                            call.ok 
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          }`}>
                            {call.ok ? 'Success' : 'Failed'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2 font-mono">
                          {call.endpoint}
                        </div>
                        {call.response && (
                          <div className="mt-3 p-3 bg-background rounded border">
                            <div className="text-xs font-semibold mb-2">Response:</div>
                            <pre className="text-xs overflow-auto max-h-40 text-muted-foreground">
                              {call.response}
                            </pre>
                          </div>
                        )}
                        {call.error && (
                          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                            <div className="text-xs font-semibold text-red-800 dark:text-red-200 mb-2">Error:</div>
                            <div className="text-xs text-red-700 dark:text-red-300">{call.error}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result?.input_type && (
                <div className="border-t pt-6">
                  <h4 className="font-semibold mb-3 text-base">Debug Info</h4>
                  <pre className="bg-muted p-3 rounded-lg overflow-auto text-xs">
                    {JSON.stringify({
                      input_type: result.input_type,
                      used_conversion: result.used_conversion,
                      visual_input_count: result.visual_input_count,
                      visual_inputs_sample: result.visual_inputs_sample,
                    }, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Index;
