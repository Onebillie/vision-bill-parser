import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  const [isAdding, setIsAdding] = useState(false);
  const [newConfig, setNewConfig] = useState<Partial<ApiConfig>>({
    name: "",
    endpoint_url: "",
    service_type: "",
    parameters: {},
    is_active: true,
  });

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
  };

  const handleAdd = async () => {
    const { error } = await supabase
      .from("api_configs")
      .insert({
        name: newConfig.name,
        endpoint_url: newConfig.endpoint_url,
        service_type: newConfig.service_type,
        parameters: newConfig.parameters,
        is_active: newConfig.is_active,
      });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Success", description: "API config added" });
      setIsAdding(false);
      setNewConfig({
        name: "",
        endpoint_url: "",
        service_type: "",
        parameters: {},
        is_active: true,
      });
      fetchConfigs();
    }
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewConfig({
      name: "",
      endpoint_url: "",
      service_type: "",
      parameters: {},
      is_active: true,
    });
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">API Configurations</h1>
            <p className="text-muted-foreground">Manage your API endpoints and parameters</p>
          </div>
          <Button onClick={() => setIsAdding(true)}>Add API Config</Button>
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
              {isAdding && (
                <TableRow>
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
                    <Input
                      placeholder="electricity, gas, meter..."
                      value={newConfig.service_type || ""}
                      onChange={(e) => setNewConfig({ ...newConfig, service_type: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Textarea
                      placeholder='{"key": "value"}'
                      value={JSON.stringify(newConfig.parameters, null, 2)}
                      onChange={(e) => {
                        try {
                          setNewConfig({ ...newConfig, parameters: JSON.parse(e.target.value) });
                        } catch {}
                      }}
                      className="font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={newConfig.is_active}
                      onChange={(e) => setNewConfig({ ...newConfig, is_active: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAdd}>Add</Button>
                      <Button size="sm" variant="outline" onClick={handleCancelAdd}>Cancel</Button>
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
                      <Input
                        value={editForm.service_type || ""}
                        onChange={(e) => setEditForm({ ...editForm, service_type: e.target.value })}
                      />
                    ) : (
                      config.service_type
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <Textarea
                        value={JSON.stringify(editForm.parameters, null, 2)}
                        onChange={(e) => {
                          try {
                            setEditForm({ ...editForm, parameters: JSON.parse(e.target.value) });
                          } catch {}
                        }}
                        className="font-mono text-xs"
                      />
                    ) : (
                      <pre className="text-xs font-mono">{JSON.stringify(config.parameters, null, 2)}</pre>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <input
                        type="checkbox"
                        checked={editForm.is_active}
                        onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                      />
                    ) : (
                      <span>{config.is_active ? "✓" : "✗"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === config.id ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave}>Save</Button>
                        <Button size="sm" variant="outline" onClick={handleCancel}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => handleEdit(config)}>Edit</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default ApiConfigs;
