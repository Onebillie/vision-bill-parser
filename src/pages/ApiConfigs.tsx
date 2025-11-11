import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

interface ApiConfig {
  id: string;
  name: string;
  endpoint_url: string;
  service_type: string;
  parameters: any;
  is_active: boolean;
}

const ApiConfigs = () => {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ApiConfig>>({});
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newConfig, setNewConfig] = useState<Partial<ApiConfig>>({
    name: "",
    endpoint_url: "",
    service_type: "",
    parameters: {},
    is_active: true,
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    const { data, error } = await supabase
      .from("api_configs")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setConfigs(data || []);
    }
    setLoading(false);
  };

  const handleEdit = (config: ApiConfig) => {
    setEditingId(config.id);
    setEditForm(config);
  };

  const handleSave = async () => {
    if (!editingId) return;

    const { error } = await supabase
      .from("api_configs")
      .update({
        name: editForm.name,
        endpoint_url: editForm.endpoint_url,
        service_type: editForm.service_type,
        parameters: editForm.parameters,
        is_active: editForm.is_active,
      })
      .eq("id", editingId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Success", description: "API config updated" });
      setEditingId(null);
      fetchConfigs();
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
    setJsonError(null);
  };

  const handleAddNew = () => {
    setIsAddingNew(true);
    setNewConfig({
      name: "",
      endpoint_url: "",
      service_type: "",
      parameters: {},
      is_active: true,
    });
    setJsonError(null);
  };

  const handleSaveNew = async () => {
    if (!newConfig.name || !newConfig.endpoint_url || !newConfig.service_type) {
      toast({ title: "Error", description: "Name, endpoint URL, and service type are required", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from("api_configs")
      .insert({
        name: newConfig.name,
        endpoint_url: newConfig.endpoint_url,
        service_type: newConfig.service_type,
        parameters: newConfig.parameters || {},
        is_active: newConfig.is_active ?? true,
      });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Success", description: "API config created" });
      setIsAddingNew(false);
      setJsonError(null);
      fetchConfigs();
    }
  };

  const handleCancelNew = () => {
    setIsAddingNew(false);
    setNewConfig({});
    setJsonError(null);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("api_configs")
      .delete()
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Success", description: "API config deleted" });
      setDeleteConfirmId(null);
      fetchConfigs();
    }
  };

  const validateJson = (jsonString: string): boolean => {
    try {
      JSON.parse(jsonString);
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError("Invalid JSON format");
      return false;
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">API Configurations</h1>
              <p className="text-muted-foreground">Manage your API endpoints and parameters</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/">← Back to Parser</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/training-docs">Training Docs</Link>
              </Button>
            </div>
          </div>
          <Button onClick={handleAddNew} disabled={isAddingNew} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Add New API
          </Button>
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Endpoint URL</TableHead>
                <TableHead>Service Type</TableHead>
                <TableHead>Parameters</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isAddingNew && (
                <TableRow className="bg-muted/50">
                  <TableCell>
                    <Input
                      placeholder="API Name"
                      value={newConfig.name || ""}
                      onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder="https://api.example.com/endpoint"
                      value={newConfig.endpoint_url || ""}
                      onChange={(e) => setNewConfig({ ...newConfig, endpoint_url: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={newConfig.service_type || ""}
                      onValueChange={(value) => setNewConfig({ ...newConfig, service_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="electricity">Electricity</SelectItem>
                        <SelectItem value="gas">Gas</SelectItem>
                        <SelectItem value="meter">Meter</SelectItem>
                        <SelectItem value="broadband">Broadband</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Textarea
                        placeholder='{"key": "value"}'
                        value={JSON.stringify(newConfig.parameters, null, 2)}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (validateJson(value)) {
                            setNewConfig({ ...newConfig, parameters: JSON.parse(value) });
                          }
                        }}
                        className="font-mono text-xs min-h-[80px]"
                      />
                      {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={newConfig.is_active ?? true}
                      onCheckedChange={(checked) => setNewConfig({ ...newConfig, is_active: !!checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveNew}>Save</Button>
                      <Button size="sm" variant="outline" onClick={handleCancelNew}>Cancel</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {configs.map((config) => (
                <TableRow key={config.id}>
                  <TableCell>
                    {editingId === config.id ? (
                      <Input
                        value={editForm.name || ""}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    ) : (
                      config.name
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <Input
                        value={editForm.endpoint_url || ""}
                        onChange={(e) => setEditForm({ ...editForm, endpoint_url: e.target.value })}
                      />
                    ) : (
                      <span className="text-sm font-mono">{config.endpoint_url}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <Select
                        value={editForm.service_type || ""}
                        onValueChange={(value) => setEditForm({ ...editForm, service_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="electricity">Electricity</SelectItem>
                          <SelectItem value="gas">Gas</SelectItem>
                          <SelectItem value="meter">Meter</SelectItem>
                          <SelectItem value="broadband">Broadband</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="capitalize">{config.service_type}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <div className="space-y-1">
                        <Textarea
                          value={JSON.stringify(editForm.parameters, null, 2)}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (validateJson(value)) {
                              setEditForm({ ...editForm, parameters: JSON.parse(value) });
                            }
                          }}
                          className="font-mono text-xs min-h-[80px]"
                        />
                        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                      </div>
                    ) : (
                      <pre className="text-xs font-mono max-w-xs overflow-auto">{JSON.stringify(config.parameters, null, 2)}</pre>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <Checkbox
                        checked={editForm.is_active}
                        onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: !!checked })}
                      />
                    ) : (
                      <span className={config.is_active ? "text-green-600" : "text-muted-foreground"}>
                        {config.is_active ? "✓ Active" : "✗ Inactive"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave}>Save</Button>
                        <Button size="sm" variant="outline" onClick={handleCancel}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(config)}>Edit</Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeleteConfirmId(config.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete API Configuration</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this API configuration? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default ApiConfigs;
