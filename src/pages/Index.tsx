import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const { toast } = useToast();

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadedFile(file);
    
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('bills')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      toast({
        title: "Upload complete",
        description: "File uploaded successfully. Ready to parse!"
      });

      // Auto-parse after upload
      await handleParse(undefined, filePath);
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  const handleParse = async (url?: string, filePath?: string) => {
    const useUrl = url || imageUrl;
    
    if (!useUrl && !filePath) {
      toast({
        title: "Error",
        description: "Please enter a URL or upload a file",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const payload: any = {};
      if (filePath) {
        payload.file_path = filePath;
      } else {
        payload.image_url = useUrl;
      }

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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Parse failed");
      }

      setResult(data);
      toast({
        title: "Success",
        description: "Bill parsed successfully!"
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to parse bill",
        variant: "destructive"
      });
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
            <CardTitle>Parse Bill</CardTitle>
            <CardDescription>
              Upload a bill file (JPG, PNG, WEBP, PDF) or enter a public URL
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            {/* URL Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Or Enter URL</label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://example.com/bill.jpg"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={loading || uploading}
                />
                <Button onClick={() => handleParse()} disabled={loading || uploading || !imageUrl}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Parsing...
                    </>
                  ) : (
                    "Parse"
                  )}
                </Button>
              </div>
            </div>

            {imageUrl && !uploadedFile && (
              <div className="border rounded-lg overflow-hidden">
                <img
                  src={imageUrl}
                  alt="Bill preview"
                  className="w-full h-auto"
                  onError={() =>
                    toast({
                      title: "Invalid image URL",
                      description: "Could not load the image",
                      variant: "destructive"
                    })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Parsed Results</CardTitle>
              <CardDescription>
                {result.routed?.length > 0 &&
                  `Routed to: ${result.routed.map((r: any) => r.endpoint).join(", ")}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-auto text-sm">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Index;
