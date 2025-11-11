import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import { Upload, FileText, Trash2, Download, Search } from "lucide-react";

interface TrainingDoc {
  id: string;
  title: string;
  description: string | null;
  document_type: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  tags: string[] | null;
  created_at: string;
}

const TrainingDocs = () => {
  const [docs, setDocs] = useState<TrainingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    document_type: "other",
    tags: "",
    file: null as File | null,
  });

  useEffect(() => {
    fetchDocs();
  }, []);

  const fetchDocs = async () => {
    const { data, error } = await supabase
      .from("training_documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setDocs(data || []);
    }
    setLoading(false);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.file || !formData.title) {
      toast({ title: "Error", description: "Title and file are required", variant: "destructive" });
      return;
    }

    setUploading(true);

    try {
      // Upload file to storage
      const fileExt = formData.file.name.split(".").pop();
      const fileName = `${Date.now()}_${formData.file.name}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("training-docs")
        .upload(filePath, formData.file);

      if (uploadError) throw uploadError;

      // Save metadata to database
      const tags = formData.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const { error: dbError } = await supabase.from("training_documents").insert({
        title: formData.title,
        description: formData.description || null,
        document_type: formData.document_type,
        file_path: filePath,
        file_name: formData.file.name,
        file_size: formData.file.size,
        mime_type: formData.file.type,
        tags: tags.length > 0 ? tags : null,
      });

      if (dbError) throw dbError;

      toast({ title: "Success", description: "Training document uploaded" });
      setFormData({ title: "", description: "", document_type: "other", tags: "", file: null });
      setShowUploadForm(false);
      fetchDocs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, filePath: string) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("training-docs")
        .remove([filePath]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from("training_documents")
        .delete()
        .eq("id", id);

      if (dbError) throw dbError;

      toast({ title: "Success", description: "Document deleted" });
      setDeleteConfirmId(null);
      fetchDocs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const getPublicUrl = (filePath: string) => {
    const { data } = supabase.storage.from("training-docs").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "Unknown";
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(1)} MB`;
  };

  const getDocTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      meter_manual: "Meter Manual",
      bill_explainer: "Bill Explainer",
      field_guide: "Field Guide",
      other: "Other",
    };
    return labels[type] || type;
  };

  const getDocTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      meter_manual: "bg-blue-500",
      bill_explainer: "bg-green-500",
      field_guide: "bg-purple-500",
      other: "bg-gray-500",
    };
    return colors[type] || "bg-gray-500";
  };

  const filteredDocs = docs.filter((doc) => {
    const query = searchQuery.toLowerCase();
    return (
      doc.title.toLowerCase().includes(query) ||
      doc.description?.toLowerCase().includes(query) ||
      doc.document_type.toLowerCase().includes(query) ||
      doc.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Training Documentation</h1>
            <p className="text-muted-foreground">Upload manuals, guides, and explainers</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/">← Back to Parser</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/api-configs">API Configs</Link>
            </Button>
          </div>
        </div>

        <div className="flex gap-4 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={() => setShowUploadForm(!showUploadForm)}>
            <Upload className="mr-2 h-4 w-4" />
            Upload Document
          </Button>
        </div>

        {showUploadForm && (
          <Card>
            <CardHeader>
              <CardTitle>Upload Training Document</CardTitle>
              <CardDescription>Add a new manual, guide, or explainer</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title *</label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Document title"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Document Type *</label>
                  <Select
                    value={formData.document_type}
                    onValueChange={(value) => setFormData({ ...formData, document_type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meter_manual">Meter Manual</SelectItem>
                      <SelectItem value="bill_explainer">Bill Explainer</SelectItem>
                      <SelectItem value="field_guide">Field Guide</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Tags</label>
                  <Input
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="Comma-separated tags (e.g., electric, meter, reading)"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">File *</label>
                  <Input
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] || null })}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Accepted formats: PDF, DOC, DOCX, PNG, JPG (max 50MB)
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={uploading}>
                    {uploading ? "Uploading..." : "Upload"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowUploadForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocs.map((doc) => (
            <Card key={doc.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                  <Badge className={getDocTypeColor(doc.document_type)}>
                    {getDocTypeLabel(doc.document_type)}
                  </Badge>
                </div>
                <CardTitle className="text-lg">{doc.title}</CardTitle>
                {doc.description && (
                  <CardDescription className="line-clamp-2">{doc.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Size: {formatFileSize(doc.file_size)}</p>
                  <p>Uploaded: {new Date(doc.created_at).toLocaleDateString()}</p>
                </div>
                {doc.tags && doc.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {doc.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    asChild
                  >
                    <a href={getPublicUrl(doc.file_path)} target="_blank" rel="noopener noreferrer">
                      <Download className="mr-2 h-4 w-4" />
                      View
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteConfirmId(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredDocs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {searchQuery ? "No documents match your search" : "No training documents yet. Upload one to get started!"}
              </p>
            </CardContent>
          </Card>
        )}

        <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Training Document</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this document? This will remove both the file and its metadata.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const doc = docs.find((d) => d.id === deleteConfirmId);
                  if (doc) handleDelete(doc.id, doc.file_path);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default TrainingDocs;
